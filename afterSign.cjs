const { notarize } = require('@electron/notarize');

module.exports = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  // Skip notarization in CI or when Apple credentials are not configured
  if (process.env.CI || !process.env.APPLE_ID) {
    console.log('Skipping notarization (no Apple credentials configured).');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  console.log(`Notarizing ${appName} in ${appOutDir}...`);

  try {
    await notarize({
      tool: 'notarytool',
      appPath: `${appOutDir}/${appName}.app`,
      keychainProfile: 'DJFriend',
    });
    console.log('Notarization complete.');
  } catch (err) {
    console.error('Notarization failed:', err);
    throw err;
  }
};
