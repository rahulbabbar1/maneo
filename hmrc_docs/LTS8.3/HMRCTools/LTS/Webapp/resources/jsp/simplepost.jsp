<html>
	<head>
		<title>Direct TPVS Endpoint Test</title>
		<link rel="stylesheet" href="/LTS/resources/style/hmrc.css" type="text/css"/>
		<link rel="stylesheet" href="/LTS/resources/style/print.css" type="text/css" media="print"/>
		<link rel="stylesheet" href="/LTS/resources/style/header.css" type="text/css"/>
		<link rel="stylesheet" href="/LTS/resources/style/banner.css" type="text/css"/>
		<link rel="stylesheet" href="/LTS/resources/style/portlet.css" type="text/css"/>
		<link rel="stylesheet" href="/LTS/resources/style/footer.css" type="text/css"/>
		<link rel="stylesheet" href="/LTS/resources/style/lists.css" type="text/css"/>
		<link rel="stylesheet" href="/LTS/resources/style/tables.css" type="text/css"/>
		<link rel="stylesheet" href="/LTS/resources/style/forms.css" type="text/css"/>
		<link rel="stylesheet" href="/LTS/resources/style/abt.css" type="text/css"/>
	
	
	<SCRIPT LANGUAGE=javascript>	
			function send() 
			{
			  var DataToSend = txtXML.value;			 			  			  
			  var xURL = '/LTS/LTSPostServlet';			 
			  var xmlhttp = new ActiveXObject("Microsoft.XMLHTTP");
			  xmlhttp.Open("POST",xURL,false);	
			  xmlhttp.setRequestHeader("Content-Type","application/x-binary");
			  xmlhttp.setRequestHeader("maxWorkForTest","1");
			  xmlhttp.send(DataToSend);			 			  
			  txtXML.value = xmlhttp.responseText;	
			}		
	

	</script>
	
	
	
	</head>
	<body>	
	
			<jsp:include page="header.jsp"/>		
			<TABLE>
				<TR>
				<TD>
					<DIV>Enter (paste) Submission Inline</DIV>
				</TD>
				</TR>
				<TR>
					<TD align="left">
						<font size="1">
							<DIV>Submitting to http://[host]:[port]/LTS/LTSPostServlet</DIV>
							<DIV>Non-browser clients can connect to this URL, and post using application/x-binary content type.</DIV>
						</font>
						<font size="2">
						<DIV><b>Contact your sys admin for [host] & [port] information.</b></DIV>
						</font>
					</TD>
				</TR>				
				<TR>
				   <TD valign="top">
					 <textarea rows="20" cols="100" name="txtXML"></textarea>
				   </TD>					
				</TR>
				
				
				<TR>
				<TD>
					<input type="button"  value="Submit" onClick="javascript:send()">
				</TD>
				</TR>
				
			</TABLE>
			
		
		            </div>
		         </div>
		       </div>
		    </div>
		
		   <ul id="footer">
		      <li class="next">Direct TPVS Endpoint Test</li>
		      <li>&nbsp;</li>
    		   </ul>	
		
	</body>
</html>