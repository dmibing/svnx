const { build, Platform, Arch } = require("electron-builder");
// The built-in portable target only supports a static BMP. A custom NSIS script
// retains one-file packaging while running the independent animation window.
build({
  targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64),
  publish: "never",
  config: {
    // Never let the portable target overwrite the installer's latest.yml.
    publish: null,
    electronDist: "node_modules/electron/dist",
    artifactName: "SVNX-${version}-win-${arch}-portable.exe",
    nsis: {
      script: "build/portable.nsi",
      oneClick: true,
      allowToChangeInstallationDirectory: false,
      differentialPackage: false,
      packElevateHelper: false,
    },
  },
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
