; Custom portable launcher. Uses electron-builder's package extraction helpers.
!include "common.nsh"
!include "extractAppPackage.nsh"
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel user
SilentInstall silent
Var StartupSignal

Function .onInit
  !insertmacro check64BitAndSetRegView
  InitPluginsDir
  StrCpy $StartupSignal "$PLUGINSDIR\startup.ready"
  File /oname=$PLUGINSDIR\SVNX.Startup.exe "${BUILD_RESOURCES_DIR}\startup\SVNX.Startup.exe"
  System::Call 'kernel32::GetCurrentProcessId() i.r0'
  Exec '"$PLUGINSDIR\SVNX.Startup.exe" $0 "$StartupSignal"'
FunctionEnd

Function StopStartup
  FileOpen $0 "$StartupSignal" w
  FileWrite $0 "done"
  FileClose $0
FunctionEnd

Function .onUserAbort
  Call StopStartup
FunctionEnd

Function .onInstFailed
  Call StopStartup
FunctionEnd

Section
  ; Per-launch directory avoids deletion of files used by another running copy.
  StrCpy $INSTDIR "$PLUGINSDIR\app"
  SetOutPath $INSTDIR
  !insertmacro extractEmbeddedAppPackage
  System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  System::Call 'kernel32::SetEnvironmentVariable(t, t)i ("SVNX_STARTUP_SIGNAL", "$StartupSignal").r0'
  ${StdUtils.GetAllParameters} $R0 0
  ClearErrors
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0' $1
  IfErrors launchFailed finished
  launchFailed:
    Call StopStartup
    MessageBox MB_OK|MB_ICONSTOP "SVNX 启动失败，请重试。"
    StrCpy $1 1
  finished:
    Call StopStartup
    SetErrorLevel $1
    SetOutPath $EXEDIR
    ; Chromium may release the executable image shortly after its main process
    ; exits. Retry only this launch's directory instead of leaving a large EXE.
    StrCpy $R2 0
  cleanup:
    ClearErrors
    RMDir /r "$INSTDIR"
    IfErrors 0 cleaned
    IntOp $R2 $R2 + 1
    IntCmp $R2 20 cleaned retryCleanup cleaned
  retryCleanup:
    Sleep 250
    Goto cleanup
  cleaned:
SectionEnd
