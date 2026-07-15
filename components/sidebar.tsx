"use client";

import Link from "next/link";
import {
  CloseIcon,
  MessageIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/icons";
import type { ChatConversation } from "@/lib/chat/history";

type SidebarProps = {
  isOpen: boolean;
  conversations: ChatConversation[];
  activeConversationId: string | null;
  onClose: () => void;
  onNewChat: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onLogout: () => void;
  isLoggingOut?: boolean;
  syncError?: string | null;
};

export function Sidebar({
  isOpen,
  conversations,
  activeConversationId,
  onClose,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  onLogout,
  isLoggingOut = false,
  syncError = null,
}: SidebarProps) {
  const handleNewChat = () => {
    onNewChat();
    onClose();
  };

  const handleSelectConversation = (conversationId: string) => {
    onSelectConversation(conversationId);
    onClose();
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] transition-opacity duration-200 md:hidden ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-gray-200 bg-gray-50 transition-transform duration-200 ease-out md:static md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="对话历史侧栏"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <span className="truncate text-sm font-semibold text-gray-900">
            ResearchGPT
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 md:hidden"
            aria-label="关闭侧栏"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={handleNewChat}
            className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-100"
          >
            <PlusIcon className="h-4 w-4 shrink-0" />
            新建对话
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {syncError && (
            <p className="mx-2 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {syncError}
            </p>
          )}

          <p className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            最近对话
          </p>

          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
              <div className="rounded-full bg-gray-200/80 p-3">
                <MessageIcon className="h-5 w-5 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500">暂无对话</p>
              <p className="text-xs text-gray-400">你的研究对话将显示在这里</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {conversations.map((conversation) => {
                const isActive = conversation.id === activeConversationId;

                return (
                  <li key={conversation.id}>
                    <div
                      className={`group flex items-center gap-1 rounded-lg ${
                        isActive ? "bg-gray-200" : "hover:bg-gray-200/80"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectConversation(conversation.id)}
                        className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-sm text-gray-700"
                        title={conversation.title}
                      >
                        {conversation.title}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteConversation(conversation.id);
                        }}
                        aria-label={`删除「${conversation.title}」`}
                        className="mr-1 rounded-md p-1.5 text-gray-400 opacity-0 transition-all hover:bg-white hover:text-red-500 group-hover:opacity-100 focus:opacity-100"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <div className="border-t border-gray-200 px-3 py-3">
          <Link
            href="/presentation"
            className="mb-2 flex w-full items-center justify-center rounded-lg bg-blue-700 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800"
          >
            成果制作
          </Link>
          <Link
            href="/literature"
            className="mb-2 flex w-full items-center justify-center rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900"
          >
            文献工作台
          </Link>
          <Link
            href="/translate"
            className="mb-2 flex w-full items-center justify-center rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900"
          >
            学术翻译
          </Link>
          <button
            type="button"
            onClick={onLogout}
            disabled={isLoggingOut}
            className="flex w-full items-center justify-center rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoggingOut ? "正在退出…" : "退出登录"}
          </button>
        </div>
      </aside>
    </>
  );
}
