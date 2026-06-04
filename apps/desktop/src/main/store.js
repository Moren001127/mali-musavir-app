'use strict';

// "Beni hatırla" için e-posta/şifreyi Windows DPAPI (safeStorage) ile şifreleyip
// userData içinde saklar. Anahtar işletim sistemine bağlıdır; düz şifre diske
// yazılmaz. Şifreleme yoksa (nadiren) hiçbir şey saklanmaz.

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

function filePath() {
  return path.join(app.getPath('userData'), 'moren-oturum.bin');
}

function saveRemember(data) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    const enc = safeStorage.encryptString(JSON.stringify(data));
    fs.writeFileSync(filePath(), enc);
    return true;
  } catch {
    return false;
  }
}

function loadRemember() {
  try {
    const p = filePath();
    if (!fs.existsSync(p)) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    const buf = fs.readFileSync(p);
    return JSON.parse(safeStorage.decryptString(buf));
  } catch {
    return null;
  }
}

function clearRemember() {
  try {
    const p = filePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* yoksay */
  }
}

module.exports = { saveRemember, loadRemember, clearRemember };
