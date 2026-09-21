@echo off
echo Compilazione di tools/keySender.exe tramite csc.exe...
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /target:exe /optimize+ /out:tools\keySender.exe tools\keySender.cs
if %ERRORLEVEL% EQU 0 (
    echo [OK] keySender.exe compilato con successo!
) else (
    echo [ERRORE] Compilazione fallita.
)
