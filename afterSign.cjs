const { notarize } = require('@electron/notarize');

module.exports = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

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
