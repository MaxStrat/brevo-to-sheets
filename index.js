const express = require('express');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || 'Feuille1';

// File d'attente pour sérialiser les écritures (évite les collisions simultanées)
let writeQueue = Promise.resolve();
function enqueue(fn) {
  writeQueue = writeQueue.then(fn).catch(err => console.error('Erreur queue:', err.message));
  return writeQueue;
}

async function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Écriture sécurisée : vérification doublon PUIS écriture, avec retry (3 tentatives)
async function writeRowSafe(row) {
  const email = (row[1] || '').toLowerCase().trim();
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const sheets = await getSheetsClient();

      // Anti-doublon : vérifier si cet email est déjà dans la colonne B
      if (email) {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!B:B`,
        });
        const existingEmails = (res.data.values || []).flat().map(e => e.toLowerCase().trim());
        if (existingEmails.includes(email)) {
          console.log(`Doublon ignoré : ${email}`);
          return;
        }
      }

      // Écriture
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:G`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
      console.log('OK - Données enregistrées dans Google Sheets');
      return; // Succès

    } catch (err) {
      console.error(`Tentative ${attempt}/${MAX_RETRIES} échouée : ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await sleep(2000 * attempt); // 2s puis 4s avant de réessayer
      } else {
        console.error(`ÉCHEC DÉFINITIF pour ${email} — données perdues :`, row);
      }
    }
  }
}

// Brevo webhook — accepte ?canal=Meta, ?canal=Organique, ?canal=Mail
app.post('/webhook', async (req, res) => {
  const payload = req.body;
  const canal = req.query.canal || '';
  console.log('--- Webhook reçu ---');
  console.log(JSON.stringify(payload, null, 2));

  try {
    const attrs = payload.attributes || payload.ATTRIBUTES || {};

    const date = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const firstName = attrs.PRENOM || attrs.FIRSTNAME || payload.PRENOM || payload.FIRSTNAME || '';
    const email = payload.email || payload.EMAIL || attrs.EMAIL || '';
    const rawPhone = attrs.TEL || attrs.SMS || attrs.PHONE || payload.TEL || payload.SMS || payload.PHONE || '';
    const phone = rawPhone ? `'${rawPhone}` : '';
    const classe = attrs.CLASSE || attrs.CLASS || '';

    // Champs custom = tout sauf les champs standards, LIVE_* et WEBINAR_*
    const standardFields = new Set(['FIRSTNAME', 'PRENOM', 'LASTNAME', 'NOM', 'SMS', 'EMAIL', 'PHONE', 'TEL', 'WHATSAPP', 'CLASSE', 'CLASS', 'OPT_IN', 'DOUBLE_OPT_IN']);
    const customParts = Object.entries(attrs)
      .filter(([key]) => !standardFields.has(key.toUpperCase()) && !key.toUpperCase().startsWith('LIVE_') && !key.toUpperCase().startsWith('WEBINAR'))
      .map(([key, val]) => `${key}: ${val}`);
    const customFields = customParts.join(' | ');

    // Ordre des colonnes : Prénom | mail | tel | canal | date inscription | Classe | champs custom
    const row = [firstName, email, phone, canal, date, classe, customFields];
    console.log('Ligne à écrire:', row);

    // Répondre immédiatement à Brevo pour éviter les retries
    res.status(200).json({ success: true });

    // Écriture en arrière-plan via la file d'attente
    enqueue(() => writeRowSafe(row));

  } catch (err) {
    console.error('ERREUR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('Serveur webhook Brevo -> Google Sheets actif');
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
