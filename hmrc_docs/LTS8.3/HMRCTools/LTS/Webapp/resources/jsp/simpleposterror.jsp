<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<%@ page import="java.util.*,java.io.*"%>

<html>
	<head>
		  <title>
				LTS Submission Uploader
		  </title>
		  <jsp:include page="includes.jsp"/>
	</head>


	<body>
		 <jsp:include page="header.jsp"/>
				
		<TABLE>						
			
			<TR>				
				<TD valign="top">
						
				</TD>
			</TR>						
			
			



			<TR>				
				<TD valign="top">
						<%
						  String msg = (String)request.getParameter("msg");
						  
						  if(msg != null)
						  	{
						  		out.println("<font size=+1>" + msg + "</font><br/>");
						  	}
						%>


						<BR>		
						Click <a href="/LTS/resources/jsp/simplepost.jsp">here</a> to go to the upload page.
				</TD>
			</TR>			
		</TABLE>

		<jsp:include page="footer.jsp"/>   
	</body>

</html>






