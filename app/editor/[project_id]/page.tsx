"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useProjectStore } from "@/lib/stores/project-store";
import { EditorProvider } from "@/components/providers/editor-provider";
import { usePlaybackControls } from "@/lib/hooks/use-playback-controls";
import { isValidUUID } from "@/lib/utils";
import dynamic from "next/dynamic";

// Dynamic import with SSR disabled to prevent HTMLElement errors
const EditorLayout = dynamic(() => import("@/components/editor/editor-layout"), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-screen flex items-center justify-center bg-background text-white">
      Loading Editor...
    </div>
  ),
});

export default function Editor() {
  const {
    activeProject,
    loadProject,
    createNewProject,
    isInvalidProjectId,
    markProjectIdAsInvalid,
  } = useProjectStore();
  const params = useParams();
  const router = useRouter();
  const projectId = params.project_id as string;
  const handledProjectIds = useRef<Set<string>>(new Set());
  const isInitializingRef = useRef<boolean>(false);

  usePlaybackControls();

  useEffect(() => {
    let isCancelled = false;

    const initProject = async () => {
      if (!projectId) {
        return;
      }

      // Validate project ID format (must be valid UUID v4)
      if (!isValidUUID(projectId)) {
        console.warn(`Invalid project ID format: ${projectId}. Creating new project.`);
        markProjectIdAsInvalid(projectId);
        
        try {
          const newProjectId = await createNewProject("Untitled Project");
          if (!isCancelled) {
            router.replace(`/editor/${newProjectId}`);
          }
        } catch (createError) {
          console.error("Failed to create new project:", createError);
        }
        return;
      }

      // Prevent duplicate initialization
      if (isInitializingRef.current) {
        return;
      }

      // Check if project is already loaded
      if (activeProject?.id === projectId) {
        return;
      }

      // Check global invalid tracking first (most important for preventing duplicates)
      if (isInvalidProjectId(projectId)) {
        return;
      }

      // Check if we've already handled this project ID locally
      if (handledProjectIds.current.has(projectId)) {
        return;
      }

      // Mark as initializing to prevent race conditions
      isInitializingRef.current = true;
      handledProjectIds.current.add(projectId);

      try {
        await loadProject(projectId);

        // Check if component was unmounted during async operation
        if (isCancelled) {
          return;
        }

        // Project loaded successfully
        isInitializingRef.current = false;
      } catch (error) {
        // Check if component was unmounted during async operation
        if (isCancelled) {
          return;
        }

        // More specific error handling - only create new project for actual "not found" errors
        const isProjectNotFound =
          error instanceof Error &&
          (error.message.includes("not found") ||
            error.message.includes("does not exist") ||
            error.message.includes("Project not found"));

        if (isProjectNotFound) {
          // Mark this project ID as invalid globally BEFORE creating project
          markProjectIdAsInvalid(projectId);

          try {
            const newProjectId = await createNewProject("Untitled Project");

            // Check again if component was unmounted
            if (isCancelled) {
              return;
            }

            router.replace(`/editor/${newProjectId}`);
          } catch (createError) {
            console.error("Failed to create new project:", createError);
          }
        } else {
          // For other errors (storage issues, corruption, etc.), don't create new project
          console.error(
            "Project loading failed with recoverable error:",
            error
          );
          // Remove from handled set so user can retry
          handledProjectIds.current.delete(projectId);
        }

        isInitializingRef.current = false;
      }
    };

    initProject();

    // Cleanup function to cancel async operations
    return () => {
      isCancelled = true;
      isInitializingRef.current = false;
    };
  }, [
    projectId,
    loadProject,
    createNewProject,
    router,
    isInvalidProjectId,
    markProjectIdAsInvalid,
  ]);

  return (
    <EditorProvider>
       <EditorLayout projectId={projectId} />
    </EditorProvider>
  );
}
