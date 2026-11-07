// Firma «ad hoc» (sin cuenta de Apple): en Mac con chip Apple una app sin ninguna firma ni siquiera abre
const {execSync} = require("child_process");
const {join} = require("path");
exports.default = async ctx => {
  if (process.platform !== "darwin" || ctx.electronPlatformName !== "darwin") return;
  const app = join(ctx.appOutDir, ctx.packager.appInfo.productFilename + ".app");
  execSync(`codesign --force --deep --sign - "${app}"`, {stdio: "inherit"});
};
