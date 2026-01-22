# Before running the sample:
#    pip install --pre azure-ai-projects>=2.0.0b1
#    pip install azure-identity

import os
from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient


project_client = AIProjectClient(
    endpoint="https://abpatra-7946-resource.services.ai.azure.com/api/projects/abpatra-7946",
    credential=DefaultAzureCredential(),
)

with project_client:

    workflow = {
        "name": "SelfCorrecting-Workflow",
        "version": "10",
    }
    
    openai_client = project_client.get_openai_client()

    conversation = openai_client.conversations.create()
    print(f"Created conversation (id: {conversation.id})")

    # Non-streaming request
    response = openai_client.responses.create(
        conversation=conversation.id,
        extra_body={"agent": {"name": workflow["name"], "type": "agent_reference"}},
        input="What is generative AI?",
        stream=False,
        metadata={"x-ms-debug-mode-enabled": "1"},
    )

    # Print response details
    print(f"\n{'='*50}")
    print(f"Response ID: {response.id}")
    print(f"Status: {getattr(response, 'status', 'N/A')}")
    print(f"{'='*50}")

    # Print usage statistics if available
    if hasattr(response, 'usage') and response.usage:
        usage = response.usage
        print(f"\n📊 Token Usage:")
        print(f"   Input tokens: {getattr(usage, 'input_tokens', 'N/A')}")
        print(f"   Output tokens: {getattr(usage, 'output_tokens', 'N/A')}")
        print(f"   Total tokens: {getattr(usage, 'total_tokens', 'N/A')}")

    # Print output items
    if hasattr(response, 'output') and response.output:
        print(f"\n📤 Output Items ({len(response.output)} total):")
        for i, item in enumerate(response.output):
            item_type = getattr(item, 'type', 'unknown')
            print(f"\n--- Item {i+1}: type={item_type} ---")
            
            if item_type == "message":
                # Print message content
                if hasattr(item, 'content') and item.content:
                    for j, content_part in enumerate(item.content):
                        part_type = getattr(content_part, 'type', 'unknown')
                        if part_type == 'output_text' and hasattr(content_part, 'text'):
                            print(f"\n📝 Text Content:\n{content_part.text}")
                        else:
                            print(f"   Content part {j}: type={part_type}")
                            
            elif item_type == "workflow_action":
                # Print workflow action details
                action_id = getattr(item, 'action_id', 'N/A')
                status = getattr(item, 'status', 'N/A')
                previous = getattr(item, 'previous_action_id', None)
                print(f"   Action ID: {action_id}")
                print(f"   Status: {status}")
                if previous:
                    print(f"   Previous Action: {previous}")
            else:
                # Print raw item for unknown types
                print(f"   {item}")

    openai_client.conversations.delete(conversation_id=conversation.id)
    print("\nConversation deleted")
