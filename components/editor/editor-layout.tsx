"use client";

import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { MediaPanel } from "@/components/editor/media-panel";
import { PropertiesPanel } from "@/components/editor/properties-panel";
import { Timeline } from "@/components/editor/timeline";
import { PreviewPanel } from "@/components/editor/preview-panel";
import { EditorHeader } from "@/components/editor/editor-header";
import { usePanelStore } from "@/lib/stores/panel-store";
import { EngineProvider } from "@/components/providers/engine-provider";
import { Onboarding } from "@/components/editor/onboarding";
import { useProjectStore } from "@/lib/stores/project-store";

interface EditorLayoutProps {
  projectId: string;
}

export default function EditorLayout({ projectId }: EditorLayoutProps) {
  const {
    toolsPanel,
    previewPanel,
    mainContent,
    timeline,
    setToolsPanel,
    setPreviewPanel,
    setMainContent,
    setTimeline,
    propertiesPanel,
    setPropertiesPanel,
    activePreset,
    resetCounter,
  } = usePanelStore();

  const { activeProject } = useProjectStore();

  // If project not loaded yet, show loading state
  if (!activeProject) {
      return (
        <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
          <EditorHeader />
          <div className="flex-1 flex items-center justify-center">
            <div className="text-muted-foreground">Loading project...</div>
          </div>
        </div>
      );
  }

  return (
      <EngineProvider
        projectId={projectId}
        projectName={activeProject.name}
        settings={{
          width: activeProject.canvasSize?.width || 1920,
          height: activeProject.canvasSize?.height || 1080,
          bitrate: 9000,
        }}
        canvas={{
          width: activeProject.canvasSize?.width || 1920,
          height: activeProject.canvasSize?.height || 1080,
          backgroundColor: activeProject.backgroundColor || "#000000",
        }}
      >
      <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
        <EditorHeader />
        <div className="flex-1 min-h-0 min-w-0">
          {activePreset === "media" ? (
            <ResizablePanelGroup
              key={`media-${activePreset}-${resetCounter}`}
              direction="horizontal"
              className="h-full w-full gap-[0.18rem] px-3 pb-3"
            >
              <ResizablePanel
                defaultSize={toolsPanel}
                minSize={15}
                maxSize={40}
                onResize={setToolsPanel}
                className="min-w-0 rounded-sm"
              >
                <MediaPanel />
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                defaultSize={100 - toolsPanel}
                minSize={60}
                className="min-w-0 min-h-0"
              >
                <ResizablePanelGroup
                  direction="vertical"
                  className="h-full w-full gap-[0.18rem]"
                >
                  <ResizablePanel
                    defaultSize={mainContent}
                    minSize={30}
                    maxSize={85}
                    onResize={setMainContent}
                    className="min-h-0"
                  >
                    <ResizablePanelGroup
                      direction="horizontal"
                      className="h-full w-full gap-[0.19rem]"
                    >
                      <ResizablePanel
                        defaultSize={previewPanel}
                        minSize={30}
                        onResize={setPreviewPanel}
                        className="min-w-0 min-h-0 flex-1"
                      >
                        <PreviewPanel />
                      </ResizablePanel>

                      <ResizableHandle withHandle />

                      <ResizablePanel
                        defaultSize={propertiesPanel}
                        minSize={15}
                        maxSize={40}
                        onResize={setPropertiesPanel}
                        className="min-w-0"
                      >
                        <PropertiesPanel />
                      </ResizablePanel>
                    </ResizablePanelGroup>
                  </ResizablePanel>

                  <ResizableHandle withHandle />

                  <ResizablePanel
                    defaultSize={timeline}
                    minSize={15}
                    maxSize={70}
                    onResize={setTimeline}
                    className="min-h-0"
                  >
                    <Timeline />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : activePreset === "inspector" ? (
            <ResizablePanelGroup
              key={`inspector-${activePreset}-${resetCounter}`}
              direction="horizontal"
              className="h-full w-full gap-[0.18rem] px-3 pb-3"
            >
              <ResizablePanel
                defaultSize={100 - propertiesPanel}
                minSize={30}
                onResize={(size) => setPropertiesPanel(100 - size)}
                className="min-w-0 min-h-0"
              >
                <ResizablePanelGroup
                  direction="vertical"
                  className="h-full w-full gap-[0.18rem]"
                >
                  <ResizablePanel
                    defaultSize={mainContent}
                    minSize={30}
                    maxSize={85}
                    onResize={setMainContent}
                    className="min-h-0"
                  >
                    <ResizablePanelGroup
                      direction="horizontal"
                      className="h-full w-full gap-[0.19rem]"
                    >
                      <ResizablePanel
                        defaultSize={toolsPanel}
                        minSize={15}
                        maxSize={40}
                        onResize={setToolsPanel}
                        className="min-w-0 rounded-sm"
                      >
                        <MediaPanel />
                      </ResizablePanel>

                      <ResizableHandle withHandle />

                      <ResizablePanel
                        defaultSize={previewPanel}
                        minSize={30}
                        onResize={setPreviewPanel}
                        className="min-w-0 min-h-0 flex-1"
                      >
                        <PreviewPanel />
                      </ResizablePanel>
                    </ResizablePanelGroup>
                  </ResizablePanel>

                  <ResizableHandle withHandle />

                  <ResizablePanel
                    defaultSize={timeline}
                    minSize={15}
                    maxSize={70}
                    onResize={setTimeline}
                    className="min-h-0"
                  >
                    <Timeline />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                defaultSize={propertiesPanel}
                minSize={15}
                maxSize={40}
                onResize={setPropertiesPanel}
                className="min-w-0 min-h-0"
              >
                <PropertiesPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : activePreset === "vertical-preview" ? (
            <ResizablePanelGroup
              key={`vertical-preview-${activePreset}-${resetCounter}`}
              direction="horizontal"
              className="h-full w-full gap-[0.18rem] px-3 pb-3"
            >
              <ResizablePanel
                defaultSize={100 - previewPanel}
                minSize={30}
                onResize={(size) => setPreviewPanel(100 - size)}
                className="min-w-0 min-h-0"
              >
                <ResizablePanelGroup
                  direction="vertical"
                  className="h-full w-full gap-[0.18rem]"
                >
                  <ResizablePanel
                    defaultSize={mainContent}
                    minSize={30}
                    maxSize={85}
                    onResize={setMainContent}
                    className="min-h-0"
                  >
                    <ResizablePanelGroup
                      direction="horizontal"
                      className="h-full w-full gap-[0.19rem]"
                    >
                      <ResizablePanel
                        defaultSize={toolsPanel}
                        minSize={15}
                        maxSize={40}
                        onResize={setToolsPanel}
                        className="min-w-0 rounded-sm"
                      >
                        <MediaPanel />
                      </ResizablePanel>

                      <ResizableHandle withHandle />

                      <ResizablePanel
                        defaultSize={propertiesPanel}
                        minSize={15}
                        maxSize={40}
                        onResize={setPropertiesPanel}
                        className="min-w-0"
                      >
                        <PropertiesPanel />
                      </ResizablePanel>
                    </ResizablePanelGroup>
                  </ResizablePanel>

                  <ResizableHandle withHandle />

                  <ResizablePanel
                    defaultSize={timeline}
                    minSize={15}
                    maxSize={70}
                    onResize={setTimeline}
                    className="min-h-0"
                  >
                    <Timeline />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                defaultSize={previewPanel}
                minSize={30}
                onResize={setPreviewPanel}
                className="min-w-0 min-h-0"
              >
                <PreviewPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <ResizablePanelGroup
              key={`default-${activePreset}-${resetCounter}`}
              direction="vertical"
              className="h-full w-full gap-[0.18rem]"
            >
              <ResizablePanel
                defaultSize={mainContent}
                minSize={30}
                maxSize={85}
                onResize={setMainContent}
                className="min-h-0"
              >
                {/* Main content area */}
                <ResizablePanelGroup
                  direction="horizontal"
                  className="h-full w-full gap-[0.19rem] px-3"
                >
                  {/* Tools Panel */}
                  <ResizablePanel
                    defaultSize={toolsPanel}
                    minSize={15}
                    maxSize={40}
                    onResize={setToolsPanel}
                    className="min-w-0 rounded-sm"
                  >
                    <MediaPanel />
                  </ResizablePanel>

                  <ResizableHandle withHandle />

                  {/* Preview Area */}
                  <ResizablePanel
                    defaultSize={previewPanel}
                    minSize={30}
                    onResize={setPreviewPanel}
                    className="min-w-0 min-h-0 flex-1"
                  >
                    <PreviewPanel />
                  </ResizablePanel>

                  <ResizableHandle withHandle />

                  <ResizablePanel
                    defaultSize={propertiesPanel}
                    minSize={15}
                    maxSize={40}
                    onResize={setPropertiesPanel}
                    className="min-w-0 rounded-sm"
                  >
                    <PropertiesPanel />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Timeline */}
              <ResizablePanel
                defaultSize={timeline}
                minSize={15}
                maxSize={70}
                onResize={setTimeline}
                className="min-h-0 px-3 pb-3"
              >
                <Timeline />
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>
        <Onboarding />
      </div>
      </EngineProvider>
  );
}

