<html><head><title>Lts Validation Results</title>
<jsp:include page="includes.jsp"/>
</head>

<body><div id='header'><img src='/LTS/resources/images/hmrcLogo.gif' alt='HM Revenue &amp; Customs' width='160' height='62' align='left' /><div id='header-title'>Online services</div>  <a name='main' class='screen-reader'></a></div><div id='banner'><h1 class='no-menu'>Local Test Service</h1></div><div align='right'><font size='2'><b>  <i> As  </i></b></font></div><div class='columns'> <div class='column'><div class='portlet no-title-bar'><div class='portlet-header'><h2></h2></div> <div class='portlet-body'><TABLE><TR><TD valign='top'><textarea ROWS='20' cols='100' value=<?xml version="1.0" encoding="UTF-8"?>
<XMLPDMProps>   
    <cif>
        <metaData>
            <Value Key="dataHandlerFQCN">uk.gov.ir.eric.cif.handlers.dataHandlers.OracleDataHandler</Value>
            <Value Key="resultsHandlerFQCN">uk.gov.ir.eric.cif.handlers.resultHandlers.ValueSetResultsHandler</Value>
            <Value Key="dataQuery">Select XML_DATA from ERIC_RECEIVED_MESSAGES where conversation_id=%conversationId</Value>
            <thirdParty>
                <Value Key="treatmentFQCN">uk.gov.ir.eric.xml.treatments.TreatmentHandlerValue</Value>
            </thirdParty>
        </metaData>
        <!--
        Old Tracking Code
        <xpathTracking>
            <Value Key="dataHandlerFQCN">uk.gov.ir.eric.cif.handlers.dataHandlers.StringDataHandler</Value>
            <Value Key="resultsHandlerFQCN">uk.gov.ir.eric.delegate.tracking.TrackingResultsHandler</Value>
            <thirdParty>
                <Value Key="treatmentFQCN">uk.gov.ir.eric.delegate.tracking.TrackingTreatmentHandler</Value>
            </thirdParty>
        </xpathTracking>
        -->
          <xpathTracking>
             <Value Key="dataHandlerFQCN">uk.gov.ir.eric.cif.handlers.dataHandlers.StringDataHandler</Value>
             <Value Key="resultsHandlerFQCN">uk.gov.ir.eric.cif.handlers.resultHandlers.NodeDataResultsHandler</Value>
             <thirdParty>
                 <Value Key="treatmentFQCN">uk.gov.ir.eric.xml.treatments.TreatmentHandlerNodeData</Value>
             </thirdParty>
        </xpathTracking>
        
        <conversationSchemaValidation>
            <Value Key="dataHandlerFQCN">uk.gov.ir.eric.cif.handlers.dataHandlers.OracleDataHandler</Value>
            <Value Key="resultsHandlerFQCN">uk.gov.ir.eric.delegate.schemaValidation.SchemaValidationResultsHandler</Value>
            <Value Key="dataQuery">Select XML_DATA from ERIC_RECEIVED_MESSAGES where conversation_id=%conversationId</Value>
            <thirdParty>
                <Value Key="treatmentFQCN"></Value>
            </thirdParty>
        </conversationSchemaValidation>
        <inputStreamSchemaValidation>
            <Value Key="dataHandlerFQCN">uk.gov.ir.eric.cif.handlers.dataHandlers.InputStreamHandler</Value>
            <Value Key="resultsHandlerFQCN">uk.gov.ir.eric.delegate.schemaValidation.SchemaValidationResultsHandler</Value>            
            <thirdParty>
                <Value Key="treatmentFQCN"></Value>
            </thirdParty>
        </inputStreamSchemaValidation>
        <stringSchemaValidation>
            <Value Key="dataHandlerFQCN">uk.gov.ir.eric.cif.handlers.dataHandlers.StringDataHandler</Value>
            <Value Key="resultsHandlerFQCN">uk.gov.ir.eric.delegate.schemaValidation.SchemaValidationResultsHandler</Value>            
            <thirdParty>
                <Value Key="treatmentFQCN"></Value>
            </thirdParty>
        </stringSchemaValidation>      
    </cif>
</XMLPDMProps>
/></textarea></TD></TR><TR><TD> Click <a href='/LTS/resources/jsp/submit.jsp'>here</a> to go to the upload page.</TD></TR></TABLE></div></div></div></div></body></html>