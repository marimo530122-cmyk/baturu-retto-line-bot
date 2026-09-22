import { google } from "googleapis";

const TEXT_MIME_TYPES = new Set(["text/plain", "text/markdown"]);
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";

function loadServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY is not set. Put the service account JSON (single line) in .env."
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON: ${err.message}`);
  }
}

function driveClient() {
  const credentials = loadServiceAccountCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

/** Find the most recently modified supported file in the configured Drive folder. */
export async function findLatestFile() {
  const folderId = process.env.GDRIVE_FOLDER_ID;
  if (!folderId) throw new Error("GDRIVE_FOLDER_ID is not set.");

  const drive = driveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    orderBy: "modifiedTime desc",
    pageSize: 10,
    fields: "files(id, name, mimeType, modifiedTime)",
  });

  const files = res.data.files ?? [];
  const supported = files.filter(
    (f) => TEXT_MIME_TYPES.has(f.mimeType) || f.mimeType === GOOGLE_DOC_MIME || f.mimeType === GOOGLE_SHEET_MIME
  );
  if (supported.length === 0) {
    throw new Error("No supported file (text/markdown/Google Doc/Sheet) found in the folder.");
  }
  return supported[0];
}

/** Download a Drive file's text content, exporting Google Docs/Sheets as needed. */
export async function downloadFileText(file) {
  const drive = driveClient();

  if (file.mimeType === GOOGLE_DOC_MIME) {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: "text/plain" },
      { responseType: "text" }
    );
    return res.data;
  }
  if (file.mimeType === GOOGLE_SHEET_MIME) {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: "text/csv" },
      { responseType: "text" }
    );
    return res.data;
  }
  const res = await drive.files.get(
    { fileId: file.id, alt: "media" },
    { responseType: "text" }
  );
  return res.data;
}

/** Convenience: find + download the latest memo in one call. */
export async function fetchLatestMemo() {
  const file = await findLatestFile();
  const text = await downloadFileText(file);
  return { file, text: text.trim() };
}
