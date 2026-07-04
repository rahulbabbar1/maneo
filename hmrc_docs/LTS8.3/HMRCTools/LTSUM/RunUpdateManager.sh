#!/bin/sh
cd `dirname $0`
CLASSPATH=.
CLASSPATH=$CLASSPATH:./resources/images
CLASSPATH=$CLASSPATH:./resources/help
CLASSPATH=$CLASSPATH:./lib/jdom-1.0.jar
CLASSPATH=$CLASSPATH:./lib/UpdateManager.jar

JAVA_OPTIONS="$JAVA_OPTIONS -Dlts.root=$LTS_HOME"

java -cp $CLASSPATH $JAVA_OPTIONS uk.gov.hmrc.aspire.lts.updatemanager.LTSUM ./resources/config/updatemanagerconfig.properties
