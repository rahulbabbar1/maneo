@ECHO off
title=Live Test Service Injector Utility

ECHO Running LTS Injector utility application...

REM The following start up command uses the default hostname and port number
REM for the LTS (http://localhost:5665/LTS)
java -jar ../lib/LTSInjector.jar source dest

REM use the following start up command to specify a custom URL for the LTS (hostname or port number)
REM java -jar ../lib/LTSInjector.jar source dest http://custom-hostname:99999/LTS

ECHO Application terminated.

PAUSE