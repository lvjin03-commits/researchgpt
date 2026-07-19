import assert from "node:assert/strict";
import { planLibraryCommand } from "../lib/chat/library-command.ts";

const folders = [
  {
    id: "folder-catalysis",
    name: "催化剂",
    parentId: null,
    description: null,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "folder-archive",
    name: "归档",
    parentId: null,
    description: null,
    createdAt: "",
    updatedAt: "",
  },
];

const papers = [
  {
    id: "paper-mannich",
    title: "Mannich Reaction Study",
    folderIds: ["folder-catalysis"],
  },
];

const cases = [
  ["创建一个叫测试资料的文件夹", "create_folder"],
  ["把文件夹 催化剂 重命名为 有机催化", "rename_folder"],
  ["删除催化剂文件夹", "delete_folder"],
  ["把文献 Mannich Reaction Study 移动到归档文件夹", "move_paper"],
  ["把Mannich Reaction Study放入文件夹归档", "add_paper_to_folder"],
  [
    "从催化剂文件夹里移除文献Mannich Reaction Study",
    "remove_paper_from_folder",
  ],
  ["删除文献 Mannich Reaction Study", "delete_paper"],
];

for (const [command, expectedKind] of cases) {
  const result = planLibraryCommand(command, folders, papers);
  assert.equal(result.type, "plan", `Expected a plan for: ${command}`);
  assert.equal(result.plan.kind, expectedKind, `Wrong action for: ${command}`);
}

assert.deepEqual(planLibraryCommand("总结这篇文献", folders, papers), {
  type: "none",
});
assert.equal(
  planLibraryCommand("删除文献 不存在的文献", folders, papers).type,
  "error",
);

console.log(`Verified ${cases.length} executable literature-library commands.`);
