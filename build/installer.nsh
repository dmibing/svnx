; Written only by the actual installer, never by portable extraction.
!macro customInstall
  FileOpen $0 "$INSTDIR\resources\svnx-installed" w
  FileWrite $0 "nsis"
  FileClose $0
!macroend
