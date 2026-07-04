@ECHO off
title=LTS Application

ECHO Running LTS Application...

REM !!!!!!!!!!     IMPORTANT    !!!!!!!!!!
REM The ordering of certain items on the CLASSPATH is significant.
REM Do not move any of the CLASSPATH entries below.

SET CLASSPATH=.

SET CLASSPATH=%CLASSPATH%;./lib/apache-el-8.5.54.jar
SET CLASSPATH=%CLASSPATH%;./lib/apache-jsp-8.5.54.jar
SET CLASSPATH=%CLASSPATH%;./lib/apache-jsp-9.4.31.v20200723.jar
SET CLASSPATH=%CLASSPATH%;./lib/asm-7.3.1.jar
SET CLASSPATH=%CLASSPATH%;./lib/asm-analysis-7.3.1.jar
SET CLASSPATH=%CLASSPATH%;./lib/asm-commons-7.3.1.jar
SET CLASSPATH=%CLASSPATH%;./lib/asm-tree-7.3.1.jar
SET CLASSPATH=%CLASSPATH%;./lib/ecj-3.19.0.jar
SET CLASSPATH=%CLASSPATH%;./lib/javax.annotation-api-1.3.jar
SET CLASSPATH=%CLASSPATH%;./lib/javax.servlet-api-4.0.1.jar
SET CLASSPATH=%CLASSPATH%;./lib/jetty-annotations-9.4.31.v20200723.jar
SET CLASSPATH=%CLASSPATH%;./lib/jetty-http-9.4.31.v20200723.jar
SET CLASSPATH=%CLASSPATH%;./lib/jetty-io-9.4.31.v20200723.jar
SET CLASSPATH=%CLASSPATH%;./lib/jetty-jndi-9.4.31.v20200723.jar
SET CLASSPATH=%CLASSPATH%;./lib/jetty-plus-9.4.31.v20200723.jar
SET CLASSPATH=%CLASSPATH%;./lib/jetty-schemas-3.1.2.jar
SET CLASSPATH=%CLASSPATH%;./lib/jetty-security-9.4.31.v20200723.jar
SET CLASSPATH=%CLASSPATH%;./lib/jetty-server-9.4.31.v20200723.jar
SET CLASSPATH=%CLASSPATH%;./lib/jetty-servlet-9.4.31.v20200723.jar
SET CLASSPATH=%CLASSPATH%;./lib/jetty-util-9.4.31.v20200723.jar
SET CLASSPATH=%CLASSPATH%;./lib/jetty-webapp-9.4.31.v20200723.jar
SET CLASSPATH=%CLASSPATH%;./lib/jetty-xml-9.4.31.v20200723.jar
SET CLASSPATH=%CLASSPATH%;./lib/taglibs-standard-impl-1.2.5.jar
SET CLASSPATH=%CLASSPATH%;./lib/taglibs-standard-spec-1.2.5.jar

SET CLASSPATH=%CLASSPATH%;./lib/commons-codec-1.3.jar
SET CLASSPATH=%CLASSPATH%;./lib/commons-fileupload-1.5.jar
SET CLASSPATH=%CLASSPATH%;./lib/commons-httpclient-3.1.jar
SET CLASSPATH=%CLASSPATH%;./lib/commons-io-1.4.jar
SET CLASSPATH=%CLASSPATH%;./lib/commons-logging-1.1.1.jar

SET CLASSPATH=%CLASSPATH%;./lib/slf4j-api-2.0.16.jar
SET CLASSPATH=%CLASSPATH%;./lib/slf4j-simple-2.0.17.jar

REM GSL Wrapper
SET CLASSPATH=%CLASSPATH%;./lib/esps_validator.jar

SET CLASSPATH=%CLASSPATH%;./lib/Utilities-Utilities.jar

REM LTS Core
SET CLASSPATH=%CLASSPATH%;./lib/LTS.jar
SET CLASSPATH=%CLASSPATH%;./lib/tools.jar

REM IR Mark validator
SET CLASSPATH=%CLASSPATH%;./lib/xmlsec-1.4.1.jar
SET CLASSPATH=%CLASSPATH%;./lib/jce-jdk13-114.jar
SET CLASSPATH=%CLASSPATH%;./lib/xalan_enhanced-2.7.0.jar

SET CLASSPATH=%CLASSPATH%;./lib/mail-1.4.jar
SET CLASSPATH=%CLASSPATH%;./lib/axiom-api-1.2.7.jar
SET CLASSPATH=%CLASSPATH%;./lib/axiom-dom-1.2.7.jar
SET CLASSPATH=%CLASSPATH%;./lib/axiom-impl-1.2.7.jar

REM GSL Schematrom Validator
SET CLASSPATH=%CLASSPATH%;./lib/GSLSchematronValidator.jar

REM GSL PAYE End of Year Validator 
SET CLASSPATH=%CLASSPATH%;./lib/antlr-3.3.jar
SET CLASSPATH=%CLASSPATH%;./lib/core-3.12.3.jar
SET CLASSPATH=%CLASSPATH%;./lib/GSLValidator.jar
SET CLASSPATH=%CLASSPATH%;./lib/poi-2.5.1-final-20040804.jar
SET CLASSPATH=%CLASSPATH%;./lib/sax2-1.0.jar
SET CLASSPATH=%CLASSPATH%;./lib/xpp3_min-1.1.3.7.jar
SET CLASSPATH=%CLASSPATH%;./lib/paye_schemas.jar
SET CLASSPATH=%CLASSPATH%;./lib/jdom-1.0.jar
SET CLASSPATH=%CLASSPATH%;./lib/velocity-dep-1.4.jar
SET CLASSPATH=%CLASSPATH%;./lib/xercesImpl-2.9.1.jar

REM Calculator
SET CLASSPATH=%CLASSPATH%;./lib/commons-collections.jar
SET CLASSPATH=%CLASSPATH%;./lib/picocontainer-1.2.jar
SET CLASSPATH=%CLASSPATH%;./lib/Calc.jar
SET CLASSPATH=%CLASSPATH%;./lib/serializer.jar
SET CLASSPATH=%CLASSPATH%;./lib/xml-apis-1.3.04.jar
SET CLASSPATH=%CLASSPATH%;./lib/xmlunit-1.1.jar

REM GSL Wrapper
SET CLASSPATH=%CLASSPATH%;./lib/esps_validator.jar

SET JAVA_OPTIONS=-Dresponder.config.generateEnvelope=true
SET JAVA_OPTIONS=%JAVA_OPTIONS% -Dresponder.config.xsltStylesheet=Webapp/resources/stylesheets/ValidationResponse.xsl
SET JAVA_OPTIONS=%JAVA_OPTIONS% -Dlts.config=resources/config/UserConfigurable/LTSConfig.xml
SET JAVA_OPTIONS=%JAVA_OPTIONS% -Dvalidator.config=resources/config/NonConfigurable/validatorConfig.xml
SET JAVA_OPTIONS=%JAVA_OPTIONS% -Dlts.root=%LTS_HOME% 
SET JAVA_OPTIONS=%JAVA_OPTIONS% -Xms128m -Xmx256m

REM Remote Debug Options
REM SET JAVA_OPTIONS=%JAVA_OPTIONS% -Xdebug -Xnoagent -Djava.compiler=NONE -Xrunjdwp:transport=dt_socket,server=y,suspend=n,address=6666

REM Run
java -cp %CLASSPATH% %JAVA_OPTIONS% uk.gov.hmrc.aspire.lts.test.LTSStandalone

ECHO Application terminated.
PAUSE
