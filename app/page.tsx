"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useProjectStore } from "@/lib/stores/project-store";

export default function Home() {
  const router = useRouter();
  const { createNewProject } = useProjectStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeProject = async () => {
      try {
        // Create a new project first, then redirect to it
        // This ensures we always have a valid UUID and proper project state
        const projectId = await createNewProject("Untitled Project");
        router.replace(`/editor/${projectId}`);
      } catch (err) {
        console.error("Failed to create new project:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to initialize editor. Please try again."
        );
      }
    };

    initializeProject();
  }, [router, createNewProject]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center max-w-md">
          <div className="mb-4">
            <h1 className="text-4xl font-bold mb-2">AlphaX</h1>
            <p className="text-xl text-muted-foreground">AI-Powered Video Editor</p>
          </div>
          <div className="p-4 bg-destructive/10 rounded-lg">
            <p className="text-sm text-destructive font-semibold mb-2">Error</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="mb-4">
          <h1 className="text-4xl font-bold mb-2">AlphaX</h1>
          <p className="text-xl text-muted-foreground">AI-Powered Video Editor</p>
        </div>
        <p className="text-sm text-muted-foreground">Initializing editor...</p>
      </div>
    </div>
  );
}

