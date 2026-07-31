export type WorkspacePanelSide = "left" | "right";

export type WorkspacePanelConfig = {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
};

export type WorkspaceLayoutConfig = {
  left: WorkspacePanelConfig;
  right: WorkspacePanelConfig;
  minimumMainWidth: number;
};

export type WorkspaceLayoutState = {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
};
