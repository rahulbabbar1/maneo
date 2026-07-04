<?xml version="1.0" encoding="UTF-8"?>

<!-- ##########################################################################
                             IMPLEMENTATION NOTE

Following is a very brief overview of the transformation process carried out
by this XSLT stylesheet:

First thing to note is the format of the 'input' document this stylesheet
expects to work on.
Below are a couple of example 'input' documents. Actual documents produced at
runtime may not contain ALL of the elements listed below.
(For instance, when the submission contains no <IRmark> then the
<IRMarkDetails> element will not be present in the 'input' document)

All Successes
=============
 <Root>
   <Envelope>
     <Class>...</Class>
     <CorrelationID>...</CorrelationID>
     <GatewayTimestamp>...</GatewayTimestamp>
     <ResponseEndPoint>...</ResponseEndPoint>
     <ValidationResult>
       <SuccessResponse />
     </ValidationResult>
     <SACalculationResult>
       <ErrorResponse>...</ErrorResponse>
     </SACalculationResult>
     <IRMarkDetails valid="true">
       <Class>...</Class>
       <FormName>...</FormName>
       <CurrentTimestamp>...</CurrentTimestamp>
       <IRmark>...</IRmark>
       <IRmarkHumanReadable>...</IRmarkHumanReadable>
       <UTR>...</UTR>
     </IRMarkDetails>
     <Envelope>
   <Root>


All Failures
============
 <Root>
   <Envelope>
     <Class>...</Class>
     <CorrelationID>...</CorrelationID>
     <GatewayTimestamp>...</GatewayTimestamp>
     <ResponseEndPoint>...</ResponseEndPoint>
     <ValidationResult>
       <ErrorResponse>
         <Error>
           <RaisedBy>...</RaisedBy>
           <Number>...</Number>
           <Type>...</Type>
           <Text>...</Text>
           <Location>...</Location>
           <Application>...</Application>
         </Error>
         <Error>
           ...
         </Error>
         ...
       </ErrorResponse>
       <ErrorCount>...</ErrorCount>
     </ValidationResult>
     <SACalculationResult>
       <ErrorResponse>
         <Error>
           <RaisedBy>...</RaisedBy>
           <Number>...</Number>
           <Type>...</Type>
           <Text>...</Text>
           <Location>...</Location>
           <Application>...</Application>
         </Error>
         <Error>
           ...
         </Error>
         ...
       </ErrorResponse>
     </SACalculationResult>
     <IRMarkDetails valid="false" />
     <Envelope>
   <Root>



The basic flow of this stylesheet is this:
 1 - Generate the header information
 2 - Use templates to generate the Validation results (errors)
 3 - Use templates to generate SA Calculation results (errors)
 4 - Use templates to generate IR Mark reciept OR error


 A number of templates exist for processing the Validation results.
 Depending on whether validation errors exist determines which of these
 templates are activated.

 Each of these templates initiates a call to other templates to create a kind
 of chain in which each template builds a specific part of the final output.

 The behaviour of some templates is interdependant on the output produced
 by previous templates. For this reason the XSLT 'mode' feature has been used
 to enable the use of specialised templates that are dedicated to handling
 specific cases.


 Here is a list of all possible permutations of the individual 'parts' of the
 response:

 Validation  |  SA Calculation  |  IR Mark
 ==========================================
   PASS             PASS            PASS
   PASS             PASS            FAIL
   PASS             PASS             -
   PASS             FAIL            PASS
   PASS             FAIL            FAIL
   PASS             FAIL             -
   PASS              -              PASS
   PASS              -              FAIL
   PASS              -               -
   FAIL             PASS            PASS
   FAIL             PASS            FAIL
   FAIL             PASS             -
   FAIL             FAIL            PASS
   FAIL             FAIL            FAIL
   FAIL             FAIL             -
   FAIL              -              PASS
   FAIL              -              FAIL
   FAIL              -               -

[Note: '-' is used to denote the feature is not applicable to or was not
present in the submission]





@author Matt Seymour
########################################################################### -->

<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
	<xsl:output method="xml"/>

	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	Root template
	This template is the top level template that matches on the root of the
	'input' document.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="/">
		<xsl:apply-templates select="/Root/Envelope"/>
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	CASE:	IR Mark 	- VALID
		Validation	- FAIL

	In this case we do not actually wish to generate any output for
	IR Mark.
	The IR Mark reciept is not generated if any validation errors exist.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="IRMarkDetails[@valid='true']" mode="validationFailure">
		<!-- do nothing -->
		<!-- although we do not wish to do anything in the case of: IR Mark VALID, validation FAILURE
		it is necessary to explicitly 'catch' this case otherwise undesirable results occur.
		(The result of each 'value-of' in the template below, which also matches the same element but is
		denied execution because of an incorrect 'mode', are printed direct to the output. Strange behaviour!)
		-->
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	CASE:	IR Mark 	- VALID
		Validation	- FAIL

	Generates the IR Mark Reciept using data obtained from the
	<IRMarkDetails> element of the 'input' document.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="IRMarkDetails[@valid='true']" mode="validationSuccess">
		<Body xmlns="http://www.govtalk.gov.uk/CM/envelope">
			<SuccessResponse xmlns="http://www.inlandrevenue.gov.uk/SuccessResponse">
				<IRmarkReceipt>
					<dsig:Signature xmlns:dsig="http://www.w3.org/2000/09/xmldsig#" xmlns="http://www.hmrc.gov.uk/ChRIS/Service/Control" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
						<dsig:SignedInfo xmlns:gti="http://www.govtalk.gov.uk/CM/envelope">
							<dsig:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
							<dsig:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>
							<dsig:Reference>
								<dsig:Transforms>
									<dsig:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
										<dsig:XPath>(count(ancestor-or-self::node()|/gti:GovTalkMessage/gti:Body)=count(ancestor-or-self::node())) and (count(ancestor-or-self::node()|/gti:GovTalkMessage/gti:Body/*[name()='IRenvelope']/*[name()='IRheader']/*[name()='IRmark'])!=count(ancestor-or-self::node()))</dsig:XPath>
									</dsig:Transform>
									<dsig:Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315#WithComments"/>
								</dsig:Transforms>
								<dsig:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>
								<dsig:DigestValue><xsl:value-of select="IRmark"/></dsig:DigestValue>
							</dsig:Reference>
						</dsig:SignedInfo>
						<dsig:SignatureValue>ov+vziKsXzCpAHOZskSSp5yJptHB+fFilM8iaV3Agy7W9/xyqQfj98+uiOBqP73mwUzmZ9dyF7OQXIg75X/AgwNUHKGvId7i+L+XxlvCDoPm1QwBX+wliaCLXEXC9u2QHTDjz+8sUjyogZDlHJJdvfgEnhrX9kT4Ge9C4TAQRtQ=</dsig:SignatureValue>
						<dsig:KeyInfo>
							<dsig:X509Data>
								<dsig:X509Certificate>MIIDKTCCApKgAwIBAgIBAjANBgkqhkiG9w0BAQQFADB1MQswCQYDVQQGEwJVUzERMA8GA1UECBMISWxsaW5vaXMxGTAXBgNVBAcTEE9ha2Jyb29rIFRlcnJhY2UxEDAOBgNVBAoTB1NhcnZlZ2ExEDAOBgNVBAsTB1N1cHBvcnQxFDASBgNVBAMTC1NhcnZlZ2FEZW1vMB4XDTA0MTAwNzE2MDYwOFoXDTI5MTAwMTE2MDYwOFoweTELMAkGA1UEBhMCVVMxETAPBgNVBAgTCElsbGlub2lzMRkwFwYDVQQHExBPYWticm9vayBUZXJyYWNlMRAwDgYDVQQKEwdTYXJ2ZWdhMRAwDgYDVQQLEwdTdXBwb3J0MRgwFgYDVQQDEw9TYXJ2ZWdhRGVtb0NlcnQwgZ8wDQYJKoZIhvcNAQEBBQADgY0AMIGJAoGBAOuak58DVFSXNRJzyvthjWYBn+yQX67cemqa1ZVF460RuwOCODZJHP8KlLnrJyZHVuBzlA0yHGKz5ABjpj/N7/IWxrC4LEH0Tuw1WCqaDTaSV2AtyEs7fgtopit6KM/yMGwqrDSHcuMi++yr5ynhfOS5uWZ9dSYwwmCtLmEauayfAgMBAAGjgcQwgcEwHQYDVR0OBBYEFH5QwQCCP0EqP0vwyRifonAT46ooMIGfBgNVHSMEgZcwgZSAFGU/dbDLz6UwZVm9DPwTghnj4tt6oXmkdzB1MQswCQYDVQQGEwJVUzERMA8GA1UECBMISWxsaW5vaXMxGTAXBgNVBAcTEE9ha2Jyb29rIFRlcnJhY2UxEDAOBgNVBAoTB1NhcnZlZ2ExEDAOBgNVBAsTB1N1cHBvcnQxFDASBgNVBAMTC1NhcnZlZ2FEZW1vggEAMA0GCSqGSIb3DQEBBAUAA4GBAJ7UjONH53zehnwbxNmLsr2FtdDSkQL9JFPEctPrjThu8w+4m/C8u+spUnIdPr9P3f5870L3/+EcePsXAc00xx4uqsrCkCD2unpKO7ZO0fqmvd2dMQqpcQv5Lm7jQa1HpmRcNwGiQhslp0K+oCxds2w4jZWt7W/l/H0Htg6kRnzD</dsig:X509Certificate>
							</dsig:X509Data>
						</dsig:KeyInfo>
					</dsig:Signature>
					<Message code="0000"><xsl:call-template name="IRMarkReceiptMessage"/> at <xsl:value-of select="CurrentTimestamp"/>		The associated IRmark was: <xsl:value-of select="IRmarkHumanReadable"/> We strongly recommend that you keep this receipt electronically, and we advise that you also keep your submission electronically for your records. They are evidence of the information that you submitted to HMRC.</Message>
				</IRmarkReceipt>
				<Message code="077001">Thank you for your submission</Message>
				<AcceptedTime><xsl:value-of select="/Root/Envelope/GatewayTimestamp"/></AcceptedTime> 				
			</SuccessResponse>
		</Body>
	</xsl:template>


	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	This is a 'named' template (i.e. only gets called explicitly) used to
	generate the first part of the message text that appears within an
	IR Mark receipt.
	This text is service-specifc and therefore requires special handling.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template name="IRMarkReceiptMessage">
		<xsl:choose>
			<xsl:when test="boolean(./UTR)">HMRC has received the <xsl:value-of select="Class"/> document ref: <xsl:value-of select="UTR"/></xsl:when>
			<xsl:otherwise>HMRC has received the <xsl:value-of select="Class"/> document</xsl:otherwise>
		</xsl:choose>
	</xsl:template>
	


	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	CASE:	IR Mark 	- INVALID
		Validation	- PASS

	Generates the IR Mark <Error> element.

	Since no validation errors exist the <Body> and <ErrorResponse>
	elements will not have already been generated.
	Knowing that there are no validation errors, we can statically assign
	the <MessageCount> to "1" (IR Mark error is the ONLY error).
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="IRMarkDetails[@valid='false']" mode="validationSuccess">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<Body xmlns="http://www.govtalk.gov.uk/CM/envelope">
			<ErrorResponse SchemaVersion="2.0" xmlns="http://www.govtalk.gov.uk/CM/errorresponse">
				<Application>
					<MessageCount>1</MessageCount>
				</Application>
				<Error>
					<RaisedBy>ChRIS</RaisedBy>
					<Number>2021</Number>
					<Type>business</Type>
					<Text>The supplied IRmark is incorrect.</Text>
					<Location>IRmark</Location>
				</Error>
			</ErrorResponse>
		</Body>
	</xsl:template>



	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	CASE:	IR Mark 	- NO IRMARK Found
		Validation	- PASS

	Generates the IR Mark <Error> element.

	Since no validation errors exist the <Body> and <ErrorResponse>
	elements will not have already been generated.
	Knowing that there are no validation errors, we can statically assign
	the <MessageCount> to "1" (IR Mark error is the ONLY error).
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="IRMarkDetails[@valid='no-irmark-found']" mode="validationSuccess">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<Body xmlns="http://www.govtalk.gov.uk/CM/envelope">
			<ErrorResponse SchemaVersion="2.0" xmlns="http://www.govtalk.gov.uk/CM/errorresponse">
				<Application>
					<MessageCount>1</MessageCount>
				</Application>
				<Error>
					<RaisedBy>ChRIS</RaisedBy>
					<Number>2022</Number>
					<Type>business</Type>
					<Text>IRmark not found.</Text>
					<Location>IRmark</Location>
				</Error>
			</ErrorResponse>
		</Body>
	</xsl:template>



	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	CASE:	IR Mark 	- INVALID
		Validation	- FAIL

	Generates the IR Mark <Error> element.

	Validation errors exist which means the <Body> and <ErrorResponse>
	elements will have already been generated.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="IRMarkDetails[@valid='false']" mode="validationFailure">
		<Error xmlns="http://www.govtalk.gov.uk/CM/errorresponse">
			<RaisedBy>ChRIS</RaisedBy>
			<Number>2021</Number>
			<Type>business</Type>
			<Text>The supplied IRmark is incorrect.</Text>
			<Location>IRmark</Location>
		</Error>
	</xsl:template>



	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	CASE:	IR Mark 	- NO IRMARK Found
		Validation	- FAIL

	Generates the IR Mark <Error> element.

	Validation errors exist which means the <Body> and <ErrorResponse>
	elements will have already been generated.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="IRMarkDetails[@valid='no-irmark-found']" mode="validationFailure">
		<Error xmlns="http://www.govtalk.gov.uk/CM/errorresponse">
			<RaisedBy>ChRIS</RaisedBy>
			<Number>2022</Number>
			<Type>business</Type>
			<Text>IRmark not found.</Text>
			<Location>IRmark</Location>
		</Error>
	</xsl:template>



	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	Generates the root of the output (response) document and the content
	of the <Header>.

	The rest of the document is generated by calling on other templates in
	this stylesheet.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="Envelope">
		<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
			<EnvelopeVersion>2.0</EnvelopeVersion>
			<Header>
				<MessageDetails>
					<Class>
						<xsl:value-of select="Class"/>
					</Class>
					<Qualifier>
						<xsl:choose>
							<!-- validation or IR Mark failure(s) -->
							<xsl:when test="count(//Error) > 0 or IRMarkDetails[@valid='false'] or IRMarkDetails[@valid='no-irmark-found']">
								error
							</xsl:when>
							<!-- validation success and IR Mark success (or non-existent) -->
							<xsl:otherwise>
								response
							</xsl:otherwise>
						</xsl:choose>
					</Qualifier>
					<!-- optional -->
					<Function>submit</Function>
					<!-- optional -->
					<CorrelationID>
						<xsl:value-of select="CorrelationID"/>
					</CorrelationID>
					<!-- optional -->
					<xsl:choose>
						<xsl:when test="boolean(./ResponseEndPoint)">
							<xsl:copy-of select="./ResponseEndPoint" />
						</xsl:when>
						<xsl:otherwise>
							<ResponseEndPoint />
						</xsl:otherwise>
					</xsl:choose>
					<!-- optional -->
					<GatewayTimestamp>
						<xsl:value-of select="GatewayTimestamp"/>
					</GatewayTimestamp>
				</MessageDetails>
			</Header>
			<GovTalkDetails>
				<!-- optional -->
				<Keys />
				<xsl:choose>
					<!-- validation or IR Mark failure(s) -->
					<xsl:when test="count(//Error) > 0 or IRMarkDetails[@valid='false'] or IRMarkDetails[@valid='no-irmark-found'] ">
						<xsl:call-template name="GovTalkError"/>
					</xsl:when>
				</xsl:choose>
			</GovTalkDetails>
			<!-- one single 'apply-templates' statement with a select of "ValidationResult"
			should accomplish the same result as the following two 'apply-templates' statements.
			Unfortunately it does not seem to behave as expected so a number of explicit
			calls are necessary -->
			<xsl:choose>
				<!-- validation success -->
				<xsl:when test="boolean(./ValidationResult/SuccessResponse)">
					<xsl:apply-templates select="ValidationResult/SuccessResponse"/>
				</xsl:when>
				<!-- validation failure-->
				<xsl:otherwise>
					<Body xmlns="http://www.govtalk.gov.uk/CM/envelope">
						<ErrorResponse SchemaVersion="2.0" xmlns="http://www.govtalk.gov.uk/CM/errorresponse">
							<xsl:apply-templates select="ValidationResult/ErrorResponse"/>
						</ErrorResponse>
					</Body>
				</xsl:otherwise>
			</xsl:choose>
		</GovTalkMessage>
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	This is a 'named' template (i.e. only gets called explicitly) used to
	generate the <GovTalkErrors> section of the response.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template name="GovTalkError">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<GovTalkErrors xmlns="http://www.govtalk.gov.uk/CM/envelope">
			<Error>
				<RaisedBy>ChRIS</RaisedBy>
				<Number>3001</Number>
				<Type>business</Type>
				<Text>Your submission failed due to business validation errors. Please see below for details</Text>
			</Error>
		</GovTalkErrors>
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	CASE:	Validation	- FAIL
		SA Calculation	- FAIL

	Output the list of <Error> elements from the SA Calculation results.

	Validation errors exist which means the <Body> and <ErrorResponse>
	elements will have already been generated.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="SACalculationResult/ErrorResponse" mode="validationFailure">
		<xsl:for-each select="Error">
			<Error xmlns="http://www.govtalk.gov.uk/CM/errorresponse">
				<xsl:apply-templates select="./RaisedBy"/>
				<xsl:apply-templates select="./Number"/>
				<xsl:apply-templates select="./Type"/>
				<xsl:apply-templates select="./Text"/>
				<xsl:apply-templates select="./Location"/>
				<xsl:apply-templates select="./Application"/>
			</Error>
		</xsl:for-each>
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	CASE:	Validation	- PASS
		SA Calculation	- FAIL

	Output the list of <Error> elements from the SA Calculation results.

	Since no validation errors exist the <Body> and <ErrorResponse>
	elements will not have already been generated.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="SACalculationResult/ErrorResponse" mode="validationSuccess">
		<xsl:choose>
			<!-- SA Calculation errors exist -->
			<xsl:when test="boolean(./Error)">
				<!-- IMPLEMENTATION NOTE:
				It is necessary to explicitly declare the default namespace of
				this element so as to prevent an undesireable side effect
				whereby an empty namespace declaration is inserted by the XSLT
				processor.
				-->
				<Body xmlns="http://www.govtalk.gov.uk/CM/envelope">
					<ErrorResponse SchemaVersion="2.0" xmlns="http://www.govtalk.gov.uk/CM/errorresponse">
						<xsl:call-template name="MessageCount"/>
						<xsl:for-each select="Error">
							<Error>
								<xsl:apply-templates select="./RaisedBy"/>
								<xsl:apply-templates select="./Number"/>
								<xsl:apply-templates select="./Type"/>
								<xsl:apply-templates select="./Text"/>
								<xsl:apply-templates select="./Location"/>
								<xsl:apply-templates select="./Application"/>
							</Error>
						</xsl:for-each>
						<xsl:apply-templates select="/Root/Envelope/IRMarkDetails" mode="validationFailure"/>
					</ErrorResponse>
				</Body>
			</xsl:when>
			<!-- no SA Calculation errors -->
			<xsl:otherwise>
				<xsl:apply-templates select="/Root/Envelope/IRMarkDetails" mode="validationSuccess"/>
			</xsl:otherwise>
		</xsl:choose>
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	This is a 'named' template (i.e. only gets called explicitly) used to
	generate the <Application><MessageCount> section of the response.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template name="MessageCount">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<Application xmlns="http://www.govtalk.gov.uk/CM/errorresponse">
			<xsl:choose>
				<!-- IR Mark is invalid - need to increment message count -->
				<xsl:when test="boolean(/Root/Envelope/IRMarkDetails[@valid='false'])">
					<MessageCount><xsl:value-of select="1 + count(/Root//Error)"/></MessageCount>
				</xsl:when>
				<!-- IR Mark is valid (or absent) - do not need to increment message count -->
				<xsl:otherwise>
					<MessageCount><xsl:value-of select="count(/Root//Error)"/></MessageCount>
				</xsl:otherwise>
			</xsl:choose>
		</Application>
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	CASE:	Validation	- FAIL

	Output the list of <Error> elements from the Validation results.

	Uses the 'MessageCount' template to also generate the <MessageCount>
	element.
	Then initiates processing of the SA Calculation and IR Mark results.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="ValidationResult/ErrorResponse">
		<xsl:call-template name="MessageCount"/>
		<xsl:for-each select="Error">
			<!-- IMPLEMENTATION NOTE:
			It is necessary to explicitly declare the default namespace of
			this element so as to prevent an undesireable side effect
			whereby an empty namespace declaration is inserted by the XSLT
			processor.
			-->
			<Error xmlns="http://www.govtalk.gov.uk/CM/errorresponse">
				<xsl:apply-templates select="./RaisedBy"/>
				<xsl:apply-templates select="./Number"/>
				<xsl:apply-templates select="./Type"/>
				<xsl:apply-templates select="./Text"/>
				<xsl:apply-templates select="./Location"/>
				<xsl:apply-templates select="./Application"/>
			</Error>
		</xsl:for-each>
		<xsl:apply-templates select="/Root/Envelope/SACalculationResult/ErrorResponse" mode="validationFailure"/>
		<xsl:apply-templates select="/Root/Envelope/IRMarkDetails" mode="validationFailure"/>
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	Generate the <RaisedBy> element.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="RaisedBy">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<RaisedBy xmlns="http://www.govtalk.gov.uk/CM/errorresponse"><xsl:value-of select="."/></RaisedBy>
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	Generate the <Number> element.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="Number">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<Number xmlns="http://www.govtalk.gov.uk/CM/errorresponse"><xsl:value-of select="."/></Number>
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	Generate the <Type> element.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="Type">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<Type xmlns="http://www.govtalk.gov.uk/CM/errorresponse"><xsl:value-of select="."/></Type>
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	Generate the <Text> element.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="Text">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<Text xmlns="http://www.govtalk.gov.uk/CM/errorresponse"><xsl:value-of select="."/></Text>
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	Generate the <Location> element.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="Location">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<Location xmlns="http://www.govtalk.gov.uk/CM/errorresponse"><xsl:value-of select="."/></Location>
	</xsl:template>






	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	Generate the <Application><Messages><DeveloperMessage> elements.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="Application/Messages">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<Application xmlns="http://www.govtalk.gov.uk/CM/errorresponse">
			<Messages xmlns="http://www.govtalk.gov.uk/validation/messages/1">
				<xsl:apply-templates select="./ServiceMessage"/>
				<xsl:apply-templates select="./DeveloperMessage"/>
			</Messages>
		</Application>
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	Generate the <Application><Messages><DeveloperMessage> elements.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="DeveloperMessage">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<DeveloperMessage xmlns="http://www.govtalk.gov.uk/validation/messages/1"><xsl:value-of select="."/></DeveloperMessage>
	</xsl:template>




	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	Generate the <Application><Messages><DeveloperMessage> elements.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="ServiceMessage">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<ServiceMessage xmlns="http://www.govtalk.gov.uk/validation/messages/1">
			<xsl:copy-of select="UserText"/>
		</ServiceMessage>
	</xsl:template>





	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	This is a 'named' template (i.e. only gets called explicitly) used to
	generate the <SuccessResponse> section of the response.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template name="SuccessResponseWithBody">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<Body xmlns="http://www.govtalk.gov.uk/CM/envelope">
			<xsl:call-template name="SuccessResponse"/>
		</Body>
	</xsl:template>



	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	This is a 'named' template (i.e. only gets called explicitly) used to
	generate the <SuccessResponse> section of the response.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
<!--
	<xsl:template name="SuccessResponse">
		<SuccessResponse xmlns="http://www.inlandrevenue.gov.uk/SuccessResponse">
			<Message code="077001">Thank you for your submission</Message> 
			<AcceptedTime><xsl:value-of select="/Root/Envelope/GatewayTimestamp"/></AcceptedTime> 
		</SuccessResponse>
	</xsl:template>
-->
	<xsl:template name="SuccessResponse">
		<!-- IMPLEMENTATION NOTE:
		It is necessary to explicitly declare the default namespace of
		this element so as to prevent an undesireable side effect
		whereby an empty namespace declaration is inserted by the XSLT
		processor.
		-->
		<Body xmlns="http://www.govtalk.gov.uk/CM/envelope">
			<SuccessResponse xmlns="http://www.inlandrevenue.gov.uk/SuccessResponse">
				<Message code="077001">Thank you for your submission</Message> 
				<AcceptedTime><xsl:value-of select="/Root/Envelope/GatewayTimestamp"/></AcceptedTime> 
			</SuccessResponse>
		</Body>
	</xsl:template>





	<!-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	CASE:	Validation	- PASS

	Validation was successful so there are no errors to output.
	Initiates processing of the SA Calculation result or IR Mark results
	if no SA Calculation results exist.
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ -->
	<xsl:template match="ValidationResult/SuccessResponse">
		<xsl:choose>
			<!-- SA Calculation results exist -->
			<xsl:when test="boolean(/Root/Envelope/SACalculationResult/ErrorResponse/Error)">
				<xsl:apply-templates select="/Root/Envelope/SACalculationResult/ErrorResponse" mode="validationSuccess"/>
			</xsl:when>
			<!-- IR Mark results exist -->
			<xsl:when test="boolean(/Root/Envelope/IRMarkDetails)">
				<xsl:apply-templates select="/Root/Envelope/IRMarkDetails" mode="validationSuccess"/>
			</xsl:when>
			<!-- All validation was successful -->
			<xsl:otherwise>
				<xsl:call-template name="SuccessResponse"/>
			</xsl:otherwise>
		</xsl:choose>
	</xsl:template>

</xsl:stylesheet>