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

// Brevo webhook
app.post('/webhook', async (req, res) => {
  const payload = req.body;
  console.log('--- Webhook reçu ---');
  console.log(JSON.stringify(payload, null, 2));

  try {
    const attrs = payload.attributes || payload.ATTRIBUTES || {};

    const date = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const firstName = attrs.FIRSTNAME || payload.FIRSTNAME || '';
    const email = payload.email || payload.EMAIL || attrs.EMAIL || '';
    const phone = attrs.SMS || attrs.PHONE || payload.SMS || payload.PHONE || '';

    // Tous les champs custom (tout sauf les champs standards)
    const standardFields = new Set(['FIRSTNAME', 'LASTNAME', 'SMS', 'EMAIL', 'PHONE', 'OPT_IN', 'DOUBLE_OPT_IN']);
    const customParts = Object.entries(attrs)
      .filter(([key]) => !standardFields.has(key.toUpperCase()))
      .map(([key, val]) => `${key}: ${val}`);

    const customFields = customParts.join(' | ');

    const row = [date, firstName, email, phone, customFields];
    console.log('Ligne à écrire:', row);

    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:E`,
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
