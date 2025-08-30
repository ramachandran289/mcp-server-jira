Jira MCP Server - Given/When/Then Format Instructions
1. List Jira Tickets Assigned to You
Given the Jira MCP server is running and properly configured
When I invoke the list_tickets tool with an optional JQL query
Then I receive a list of Jira tickets assigned to me, formatted as <issue key>: <summary> (<status>), or a message if no tickets are found

2. Get Details of a Specific Jira Ticket
Given the Jira MCP server is running and properly configured
When I invoke the get_ticket tool with a valid Jira ticket ID
Then I receive the ticket's key, summary, status, type, description, parent, and linked issues, or an error message if the ticket is not found

3. Get Comments for a Specific Jira Ticket
Given the Jira MCP server is running and properly configured
When I invoke the get_comments tool with a valid Jira ticket ID
Then I receive all comments for the ticket, including author, date, and body, or a message if no comments are found

4. Create a New Jira Ticket
Given the Jira MCP server is running and properly configured
When I invoke the create_ticket tool with the required ticket fields (summary, description, projectKey, issueType, optional parent)
Then a new Jira ticket is created and its key is returned, or an error message if creation fails

5. Add a Comment to a Jira Ticket
Given the Jira MCP server is running and properly configured
When I invoke the add_comment tool with a valid ticket ID and comment body
Then the comment is added to the ticket, or an error message if the operation fails

6. Update the Status of a Jira Ticket
Given the Jira MCP server is running and properly configured
When I invoke the update_status tool with a valid ticket ID and transition ID
Then the ticket's status is updated, or an error message if the operation fails

7. Search for Tickets in Specific Projects Using Text Search
Given the Jira MCP server is running and properly configured
When I invoke the search_tickets tool with search text, comma-separated project keys, and optional maxResults
Then I receive a list of matching tickets with summary, status, updated date, project, and description, or a message if no tickets are found