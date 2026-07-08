const { notarize } = require('@electron/notarize');

exports.default = async function afterSign(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const appName = ctx.packager.appInfo.productFilename;
  const appPath = `${ctx.appOutDir}/${appName}.app`;
  const keychainProfile = process.env.NOTARIZE_KEYCHAIN_PROFILE || 'vochi-notary';
  console.log(`[notarize] ${appPath} via keychain profile "${keychainProfile}"`);
  await notarize({ tool: 'notarytool', appPath, keychainProfile });
  console.log('[notarize] done');
};
