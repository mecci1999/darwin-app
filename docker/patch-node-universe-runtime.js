const fs = require('fs');
const path = require('path');

const patchDirectory = process.argv[2];
if (!patchDirectory || !fs.existsSync(path.join(patchDirectory, 'index.js'))) {
  throw new Error('A compiled node-universe dist directory is required');
}

// The overlay script is copied to /tmp, while the installed dependency lives
// under the image work directory. Resolve explicitly from that work directory
// instead of relying on this script's own module path.
const packageDirectory = path.dirname(
  require.resolve('node-universe/package.json', { paths: [process.cwd()] })
);
const packageVersion = require(path.join(packageDirectory, 'package.json')).version;
if (packageVersion !== '1.7.4') {
  throw new Error(`Expected node-universe@1.7.4, received ${packageVersion}`);
}

const targetDirectory = path.join(packageDirectory, 'dist');
fs.rmSync(targetDirectory, { recursive: true, force: true });
fs.cpSync(patchDirectory, targetDirectory, { recursive: true });

const runtimeEntry = fs.readFileSync(path.join(targetDirectory, 'index.js'), 'utf8');
if (!runtimeEntry.includes('instanceEpoch') || !runtimeEntry.includes('kafka_js_restart')) {
  throw new Error('The node-universe registry convergence patch was not installed');
}

process.stdout.write(`Patched node-universe@${packageVersion} runtime\n`);
