<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html>
	<head>
	  <title>
			LTS EMCS SOAP Submission Uploader
	  </title>
	  <jsp:include page="/resources/jsp/includes.jsp"/>
		  <meta http-equiv="content-type" content="text/html; charset=ISO-8859-1">
	</head>
<body>

 <jsp:include page="/resources/jsp/soapheader.jsp"/>

	<form name="LTSsubmissionForm" method="post" enctype="multipart/form-data" action="/LTS/SoapClientServlet" onsubmit="return validateForm()">
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
					<td>Please specify destination URL:</td>
					<td>
						<select name="hiddenuri">
							<!--FS4 URLs -->
							<option value="/EMCS/SubmitExplainDelayToDelivery/4">FS4 - /EMCS/SubmitExplainDelayToDelivery/4</option>
							<option value="/EMCS/SubmitReportofReceipt/4">FS4 - /EMCS/SubmitReportofReceipt/4</option>
							<option value="/EMCS/GetMovementForTrader/4">FS4- /EMCS/GetMovementForTrader/4</option>
							<option value="/EMCS/GetNewMessages/4">FS4- /EMCS/GetNewMessages/4</option>
							<option value="/EMCS/AcknowledgeMessagesReceipt/4">FS4 - /EMCS/AcknowledgeMessagesReceipt/4</option>
							<option value="/EMCS/SubmitChangeOfDestination/3">FS4 - /EMCS/SubmitChangeOfDestination/3</option>
							<option value="/EMCS/SubmitCancellation/3">FS4 - /EMCS/SubmitCancellation/3</option>
							<option value="/EMCS/SubmitDraftMovement/3">FS4 - /EMCS/SubmitDraftMovement/3</option>
							<option value="/EMCS/PreValidateTrader/3">FS4 - /EMCS/PreValidateTrader/3</option>
							<option value="/EMCS/SubmitSplitMovement/2">FS4 - /EMCS/SubmitSplitMovement/2</option>
							<option value="/EMCS/SubmitAlertOrRejectionMovement/2">FS4 - /EMCS/SubmitAlertOrRejectionMovement/2</option>
							<option value="/EMCS/SubmitReasonForShortage/2">FS4 - /EMCS/SubmitReasonForShortage/2</option>
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

				var re = /\s*((\S+\s*)*)/;  /^\s+/g
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
      <li class="next">LTS SOAP File Uploader</li>
      <li>&nbsp;</li>
    </ul>
</body>
</html>