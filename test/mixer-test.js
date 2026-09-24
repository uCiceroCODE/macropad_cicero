// test/mixer-test.js
// Sanity test for per‑app mixer command flow.
// Run with: node test/mixer-test.js

const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

// Mock global hardware with a simple sendLine that records output
global.sentLines = [];
global.hardware = {
  sendLine(line) {
    console.log('[Test] → Arduino:', line);
    global.sentLines.push(line);
  }
};

const { handleCommand } = require('../src/main/serialHandler');

(async () => {
  try {
    console.log('\n=== Test 1: CMD:GET_MIXER_APPS ===');
    await handleCommand('CMD:GET_MIXER_APPS');
    const listLine = global.sentLines[global.sentLines.length - 1];
    console.log('Response:', listLine);
    if (!listLine || !listLine.startsWith('MIXER_LIST:')) {
      console.error('FAIL: expected MIXER_LIST:...');
      process.exit(1);
    }
    console.log('PASS ✓');

    // Extract first app name from the list for select test
    const apps = listLine.substring('MIXER_LIST:'.length).split('|').filter(Boolean);
    const testApp = apps[0] || 'MockApp';
    console.log(`\n=== Test 2: CMD:SELECT_APP:${testApp} ===`);
    await handleCommand(`CMD:SELECT_APP:${testApp}`);
    const selLine = global.sentLines[global.sentLines.length - 1];
    console.log('Response:', selLine);
    if (!selLine || !selLine.startsWith('MIXER_SELECTED:')) {
      console.error('FAIL: expected MIXER_SELECTED:...');
      process.exit(1);
    }
    console.log('PASS ✓');

    console.log('\n=== Test 3: CMD:VOL_UP ===');
    await handleCommand('CMD:VOL_UP');
    const volLine = global.sentLines[global.sentLines.length - 1];
    console.log('Response:', volLine);
    if (!volLine || !volLine.startsWith('MIXER_VOL:')) {
      console.error('FAIL: expected MIXER_VOL:...');
      process.exit(1);
    }
    console.log('PASS ✓');

    console.log('\n=== Test 4: CMD:VOL_DOWN ===');
    await handleCommand('CMD:VOL_DOWN');
    const volLine2 = global.sentLines[global.sentLines.length - 1];
    console.log('Response:', volLine2);
    if (!volLine2 || !volLine2.startsWith('MIXER_VOL:')) {
      console.error('FAIL: expected MIXER_VOL:...');
      process.exit(1);
    }
    console.log('PASS ✓');

    console.log('\n=============================');
    console.log('All tests passed! ✓');
    console.log('Sent lines:', global.sentLines);
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
})();
