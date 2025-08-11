# Examples

This guide provides the recommended implementation pattern for integrating `copilotedge` into a Next.js App Router application.

For the full, working code, please see the files in the [`/examples`](../examples/) directory of the repository.

---

## The Golden Path: Next.js App Router with CopilotKit UI

This is the simplest and most robust way to get started. It uses the pre-built UI components from CopilotKit to handle the entire chat interface for you.

### 1. Create the API Route

This is the backend endpoint that the CopilotKit frontend will communicate with. The `createCopilotEdgeHandler` function handles everything you need, including reading environment variables for your Cloudflare credentials.

```typescript
// file: app/api/copilotedge/route.ts

import { createCopilotEdgeHandler } from "copilotedge";

// This single line creates your API endpoint.
// It automatically uses your CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
// from your .env.local file.
export const POST = createCopilotEdgeHandler();

// For more advanced options, like using a custom model, you can pass a
// configuration object. See the `basic-usage.jsx` example for details.
```

### 2. Set Up the CopilotKit Provider

In your root layout, wrap your application with the `<CopilotKit>` provider. This gives all child components access to the chat context. We will also add the `<CopilotPopup>` component here, which renders the chat window.

```tsx
// file: app/layout.tsx

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css"; // Import the default styles

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <CopilotKit runtimeUrl="/api/copilotedge">
          {children}

          {/* This component renders the entire chat UI for you */}
          <CopilotPopup
            instructions="You are a helpful AI assistant powered by CopilotEdge."
            defaultOpen={true}
            labels={{
              title: "CopilotEdge Assistant",
              initial: "Hello! How can I help you today?",
            }}
          />
        </CopilotKit>
      </body>
    </html>
  );
}
```

### 3. Create Your Page

With the API route and the UI provider in place, your page component can be very simple. The `<CopilotPopup>` handles all the chat functionality automatically.

```tsx
// file: app/page.tsx

export default function Page() {
  return (
    <div>
      <h1>Welcome to Your AI-Powered App</h1>
      <p>
        Click the chat icon in the bottom right corner to interact with the
        CopilotEdge assistant.
      </p>
    </div>
  );
}
```

That's it! With these three pieces of code, you have a fully functional AI chat assistant powered by Cloudflare's edge network.
