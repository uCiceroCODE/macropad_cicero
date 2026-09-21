const { exec, execFile } = require('child_process');
const { shell } = require('electron');
const path = require('path');

/**
 * Dispatcher per l'esecuzione delle azioni associate ai tasti del Macro Pad.
 * Supporta:
 * - KEY: Simulazione tasto singolo o combinazione tastiera (es. Ctrl+C, Win+D, Alt+Tab, F1-F24, Volume_Up)
 * - TEXT: Digitazione automatica di caratteri custom, stringhe o testi
 * - MACRO: Esecuzione di macro sequenziali con ritardi
 * - APP: Avvio file .exe o applicazione di sistema (es. calc.exe, notepad)
 * - POWERSHELL: Esecuzione comandi/script PowerShell con bypass delle execution policy
 * - BASH: Esecuzione comandi/script Linux tramite WSL (wsl bash -c)
 * - URL: Apertura link web nel browser predefinito di Windows
 */
class ActionDispatcher {
  /**
   * Esegue l'azione configurata.
   * @param {object} action - { type: 'KEY'|'TEXT'|'MACRO'|'APP'|'POWERSHELL'|'BASH'|'URL', value: string, label?: string }
   * @returns {Promise<{ success: boolean, output?: string, error?: string }>}
   */
  static async execute(action) {
    if (!action || !action.type || (action.value === undefined && action.type !== 'KEY')) {
      console.warn('[ActionDispatcher] Nessuna azione configurata o parametri mancanti:', action);
      return { success: false, error: 'Azione non configurata' };
    }

    const { type, value, label } = action;
    console.log(`[ActionDispatcher] Esecuzione azione [${type}] "${label || value}"`);

    switch (type.toUpperCase()) {
      case 'KEY':
        return ActionDispatcher.executeKey(value);

      case 'TEXT':
        return ActionDispatcher.executeText(value);

      case 'MACRO':
        return ActionDispatcher.executeMacro(value);

      case 'APP':
        return ActionDispatcher.executeApp(value);

      case 'POWERSHELL':
        return ActionDispatcher.executePowerShell(value);

      case 'BASH':
        return ActionDispatcher.executeBash(value);

      case 'URL':
        return ActionDispatcher.executeUrl(value);

      default:
        console.warn(`[ActionDispatcher] Tipo di azione non riconosciuto: ${type}`);
        return { success: false, error: `Tipo di azione non supportato: ${type}` };
    }
  }

  /**
   * Recupera il percorso dell'utility nativa Win32 SendInput (keySender.exe).
   */
  static getKeySenderPath() {
    return path.resolve(__dirname, '../../tools/keySender.exe');
  }

  /**
   * Simula la pressione di un singolo tasto o di una combinazione (es. 'Ctrl+C', 'Win+D', 'F13', 'Volume_Up').
   */
  static executeKey(comboOrKey) {
    return new Promise((resolve) => {
      const exePath = ActionDispatcher.getKeySenderPath();
      const val = (comboOrKey || '').trim();
      const mode = val.includes('+') ? '--combo' : '--key';

      execFile(exePath, [mode, val], (err, stdout, stderr) => {
        if (err) {
          console.error('[ActionDispatcher:KEY] Errore:', err.message);
          return resolve({ success: false, error: err.message });
        }
        resolve({ success: true, output: `Tasto emulato: ${val}` });
      });
    });
  }

  /**
   * Digita automaticamente caratteri custom o stringhe di testo con supporto Unicode nativo.
   */
  static executeText(textString) {
    return new Promise((resolve) => {
      const exePath = ActionDispatcher.getKeySenderPath();
      const val = textString !== undefined ? String(textString) : '';

      execFile(exePath, ['--text', val], (err, stdout, stderr) => {
        if (err) {
          console.error('[ActionDispatcher:TEXT] Errore:', err.message);
          return resolve({ success: false, error: err.message });
        }
        resolve({ success: true, output: `Digitato testo (${val.length} car): "${val}"` });
      });
    });
  }

  /**
   * Esegue una sequenza di passi (macro) separati da ';' o virgola.
   * Esempio: "KEY:CTRL+A; DELAY:100; KEY:BACKSPACE; TEXT:Ciao Mondo!; KEY:ENTER"
   */
  static async executeMacro(macroString) {
    const steps = (macroString || '').split(/;|\n/).map(s => s.trim()).filter(Boolean);
    const exePath = ActionDispatcher.getKeySenderPath();

    for (const step of steps) {
      if (/^DELAY:?(\d+)$/i.test(step)) {
        const ms = parseInt(step.replace(/^DELAY:?/i, ''), 10) || 100;
        await new Promise(r => setTimeout(r, ms));
      } else if (/^TEXT:(.*)$/is.test(step)) {
        const txt = step.replace(/^TEXT:/is, '');
        await new Promise(r => execFile(exePath, ['--text', txt], r));
      } else if (/^KEY:(.*)$/i.test(step)) {
        const k = step.replace(/^KEY:/i, '').trim();
        const mode = k.includes('+') ? '--combo' : '--key';
        await new Promise(r => execFile(exePath, [mode, k], r));
      } else {
        // Se non specificato prefisso, prova combo o tasto
        const mode = step.includes('+') ? '--combo' : '--key';
        await new Promise(r => execFile(exePath, [mode, step], r));
      }
    }

    return { success: true, output: `Macro completata (${steps.length} passi)` };
  }

  /**
   * Avvia un'applicazione Windows (.exe o app registrata nel sistema).
   */
  static executeApp(appCommand) {
    return new Promise((resolve) => {
      const sanitized = appCommand.trim();
      const command = sanitized.includes(' ') && !sanitized.startsWith('"')
        ? `start "" "${sanitized}"`
        : `start "" ${sanitized}`;

      exec(command, { windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          console.error('[ActionDispatcher:APP] Errore:', err.message);
          return resolve({ success: false, error: err.message });
        }
        resolve({ success: true, output: stdout || stderr });
      });
    });
  }

  /**
   * Esegue un comando o script PowerShell con ExecutionPolicy Bypass.
   */
  static executePowerShell(psCommand) {
    return new Promise((resolve) => {
      const escapedCmd = psCommand.replace(/"/g, '`"');
      const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${escapedCmd}"`;

      exec(command, { windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          console.error('[ActionDispatcher:POWERSHELL] Errore:', err.message);
          return resolve({ success: false, error: err.message, output: stderr });
        }
        resolve({ success: true, output: stdout.trim() });
      });
    });
  }

  /**
   * Esegue un comando bash nativo Linux attraverso WSL.
   */
  static executeBash(bashCommand) {
    return new Promise((resolve) => {
      const escapedCmd = bashCommand.replace(/"/g, '\\"');
      const command = `wsl.exe bash -c "${escapedCmd}"`;

      exec(command, { windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          console.error('[ActionDispatcher:BASH] Errore:', err.message);
          return resolve({ success: false, error: err.message, output: stderr });
        }
        resolve({ success: true, output: stdout.trim() });
      });
    });
  }

  /**
   * Apre l'URL specificato nel browser predefinito di sistema.
   */
  static async executeUrl(url) {
    try {
      let targetUrl = url.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
      }

      if (shell && typeof shell.openExternal === 'function') {
        await shell.openExternal(targetUrl);
        return { success: true, output: `Aperto: ${targetUrl}` };
      } else {
        return new Promise((resolve) => {
          exec(`start "" "${targetUrl}"`, (err) => {
            if (err) return resolve({ success: false, error: err.message });
            resolve({ success: true, output: `Aperto: ${targetUrl}` });
          });
        });
      }
    } catch (err) {
      console.error('[ActionDispatcher:URL] Errore:', err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = ActionDispatcher;
