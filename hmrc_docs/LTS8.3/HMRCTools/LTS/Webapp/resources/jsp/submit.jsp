<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html>
	<head>
	  <title>
			LTS Submission Uploader
	  </title>
	  <jsp:include page="includes.jsp"/>
		  <meta http-equiv="content-type" content="text/html; charset=ISO-8859-1">
	</head>
<body>

 <jsp:include page="header.jsp"/>
	<form name="LTSsubmissionForm" action="/LTS/LTSServlet?client=thin" method="post" enctype="multipart/form-data">
			<TABLE>
					<TR>
						<TD valign="top">Specify your Submission file:</TD>
						<TD valign="top"><input type="file" name="submissionFile"></TD>
					</TR>
					<TR>
						<TD colspan="4" align="left"><input type="button" value="Upload" onclick="validateForm()"/>
						</TD>
					</TR>
			</TABLE>
	</form>
	
		<script>
			function validateForm()
			{
				 
				 
				 var filePath = trim(document.LTSsubmissionForm.submissionFile.value);
								 
				 if (filePath =='')
				 {
				   alert('Field must be entered');
				   document.LTSsubmissionForm.submissionFile.focus();
				   return false;
				 }
				 document.LTSsubmissionForm.submit();
			}
			
						// Removes leading whitespaces
			function LTrim( value ) {
				
				var re = /\s*((\S+\s*)*)/;
				return value.replace(re, "$1");
				
			}
			
			// Removes ending whitespaces
			function RTrim( value ) {
				
				var re = /((\s*\S+)*)\s*/;
				return value.replace(re, "$1");
				
			}
			
			// Removes leading and ending whitespaces
			function trim( value ) 
			{
				return LTrim(RTrim(value));				
			}
			
		</script>
    
           </div>
         </div>
       </div>
    </div>

   <ul id="footer">
      <li class="next">LTS File Uploader</li>
      <li>&nbsp;</li>
    </ul>
</body>
</html>
