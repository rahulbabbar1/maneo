#!/bin/sh

cd `dirname $0`

echo Running LTS Injector utility application...

# The following start up command uses the default hostname and port number for
# the LTS (http://localhost:5665/LTS)
java -jar ../lib/LTSInjector.jar source dest

# Use the following start up command to specify a custom hostname and port
# number for the LTS
# java -jar ../lib/LTSInjector.jar source dest http://custom-hostname:99999/LTS

echo Application terminated.
echo Press [Return] to exit . . .
read ignoreInput

exit 0
