import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CollectionBrowser from "./components/CollectionBrowser";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background text-foreground">
        <CollectionBrowser />
      </div>
    </QueryClientProvider>
  );
}

export default App;
