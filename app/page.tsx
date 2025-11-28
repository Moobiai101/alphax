"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // For now, redirect to a demo project
    // TODO: In production, show projects list or create new project flow
    router.push("/editor/demo-project");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="mb-4">
          <h1 className="text-4xl font-bold mb-2">AlphaX</h1>
          <p className="text-xl text-muted-foreground">AI-Powered Video Editor</p>
        </div>
        <p className="text-sm text-muted-foreground">Loading editor...</p>
      </div>
    </div>
  );
}

