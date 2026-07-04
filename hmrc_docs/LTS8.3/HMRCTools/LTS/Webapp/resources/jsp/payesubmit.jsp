<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html>
	<head>
	  <title>
			LTS PAYE End of Year Submission Uploader
	  </title>
	  <jsp:include page="/resources/jsp/includes.jsp"/>
		  <meta http-equiv="content-type" content="text/html; charset=ISO-8859-1">
	</head>
<body>

 <jsp:include page="/resources/jsp/headerpaye.jsp"/>

	<form name="LTSsubmissionForm" method="post" enctype="multipart/form-data" action="/LTS/LTSPAYEEoYServlet?client=thin" onsubmit="return validateForm()">
			<TABLE>
					<TR>
						<TD valign="top"></TD>
						<TD valign="top"></TD>
					</TR>
					<TR>
						<TD valign="top">Specify your Submission file:</TD>
						<TD valign="top"><input type="file" name="submissionFile"></TD>
					</TR>

					<tr>
					<td>Please specify Tax Year:</td>
					<td>
					<select name="hiddenTaxYear">
						<option value="0708">07/08</option>
						<option value="0809">08/09</option>
						<option value="0910">09/10</option>
						<option value="1011">10/11</option>
						<option value="1112">11/12</option>
						<option value="1213">12/13</option>
						<option value="1314">13/14</option>
					</select>
					</td>
					</tr>
					<tr />
					<TR>
						<TD colspan="4" align="left"><input type="submit" value="Upload"/>
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
				 return true;
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
      <li class="next">LTS PAYE End Of Year File Uploader</li>
      <li>&nbsp;</li>
    </ul>
</body>
</html>
