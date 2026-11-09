require('/piston_api/node_modules/nocamel');
const Package = require('/piston_api/src/package');

const REQUIRED_PACKAGES = ['python', 'gcc', 'java', 'php', 'node'];

async function installRequiredPackages() {
  for (const language of REQUIRED_PACKAGES) {
    const pkg = await Package.get_package(language, '*');

    if (!pkg) {
      throw new Error(`Required package not found in repository: ${language}`);
    }

    try {
      const result = await pkg.install();
      console.log(`[bootstrap] Installed ${result.language}-${result.version}`);
    } catch (error) {
      if (error && error.message === 'Already installed') {
        console.log(`[bootstrap] Already installed: ${language}`);
        continue;
      }

      throw error;
    }
  }
}

installRequiredPackages()
  .then(() => {
    console.log('[bootstrap] Runtime package bootstrap completed');
  })
  .catch(error => {
    console.error('[bootstrap] Runtime package bootstrap failed:', error.message || error);
    process.exit(1);
  });
