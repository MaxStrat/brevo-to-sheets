const express = require('express');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || 'Feuille1';

async function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
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

    // Champs custom = tout sauf les champs déjà capturés dans les colonnes
    const standardFields = new Set(['FIRSTNAME', 'PRENOM', 'LASTNAME', 'NOM', 'SMS', 'EMAIL', 'PHONE', 'TEL', 'WHATSAPP', 'CLASSE', 'CLASS', 'OPT_IN', 'DOUBLE_OPT_IN']);
    const customParts = Object.entries(attrs)
      .filter(([key]) => !standardFields.has(key.toUpperCase()))
      .map(([key, val]) => `${key}: ${val}`);

    const customFields = customParts.join(' | ');

    // Ordre des colonnes : Prénom | mail | tel | canal | date inscription | Classe | champs custom
    const row = [firstName, email, phone, canal, date, classe, customFields];
    console.log('Ligne à écrire:', row);

    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:G`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });

    console.log('OK - Données enregistrées dans Google Sheets');
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('ERREUR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check (pour vérifier que le serveur tourne)
app.get('/', (req, res) => {
  res.send('Serveur webhook Brevo -> Google Sheets actif');
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
