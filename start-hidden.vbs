' Start Kurarium with no visible window.
' Double-click this file: the server starts hidden (logs to data\server.log)
' and the browser opens as soon as the server responds.
Option Explicit

Dim sh, fso, rootDir, backendDir, dataDir, port, cfgPath, cfgFile, cfgText, lines, i, line, eq, key
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
backendDir = rootDir & "\backend"
dataDir = rootDir & "\data"

If Not fso.FolderExists(dataDir) Then
  fso.CreateFolder(dataDir)
End If

' Read server port from the hidden config (default 3000)
port = 3000
cfgPath = dataDir & "\.system\config.ini"
If Not fso.FileExists(cfgPath) Then
  cfgPath = rootDir & "\config.ini"
End If
If fso.FileExists(cfgPath) Then
  Set cfgFile = fso.OpenTextFile(cfgPath, 1)
  cfgText = cfgFile.ReadAll
  cfgFile.Close
  lines = Split(Replace(cfgText, vbCr, ""), vbLf)
  For i = 0 To UBound(lines)
    line = Trim(lines(i))
    If Left(line, 1) <> ";" And Left(line, 1) <> "#" Then
      eq = InStr(line, "=")
      If eq > 0 Then
        key = LCase(Trim(Left(line, eq - 1)))
        If key = "port" Then
          If IsNumeric(Trim(Mid(line, eq + 1))) Then
            port = CLng(Trim(Mid(line, eq + 1)))
          End If
        End If
      End If
    End If
  Next
End If

' First run only: install dependencies (hidden, wait for completion)
If Not fso.FolderExists(backendDir & "\node_modules") Then
  sh.Run "cmd /c cd /d """ & backendDir & """ && npm install >> """ & dataDir & "\npm-install.log"" 2>&1", 0, True
End If

sh.CurrentDirectory = backendDir
' Launch server hidden (do not wait)
sh.Run "cmd /c set UV_THREADPOOL_SIZE=16&& npm run dev >> """ & dataDir & "\server.log"" 2>&1", 0, False

' Wait until the server responds (up to 60s), then open the browser
Dim http, tries
For tries = 1 To 120
  WScript.Sleep 500
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.open "GET", "http://localhost:" & port & "/api/folders", False
  http.send
  If Err.Number = 0 Then
    On Error GoTo 0
    Exit For
  End If
  Err.Clear
  On Error GoTo 0
Next

sh.Run "http://localhost:" & port & "/"
