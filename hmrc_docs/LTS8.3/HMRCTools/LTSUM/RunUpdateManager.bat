@echo off

set CLASSPATH=.;./resources/images
set CLASSPATH=%CLASSPATH%;./resources/help
set CLASSPATH=%CLASSPATH%;./lib/jdom-1.0.jar
set CLASSPATH=%CLASSPATH%;./lib/UpdateManager.jar

SET JAVA_OPTIONS=-Dlts.root=%LTS_HOME%

start javaw -cp %CLASSPATH% %JAVA_OPTIONS% uk.gov.hmrc.aspire.lts.updatemanager.LTSUM ./resources/config/updatemanagerconfig.properties
