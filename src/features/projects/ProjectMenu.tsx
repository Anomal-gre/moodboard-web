import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  FolderPlus,
  LayoutGrid,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { Project } from '../../domain/types';
import type { I18nDict } from '../../i18n';

interface ProjectMenuProps {
  projects: Project[];
  activeProject: Project;
  dict: I18nDict;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onDuplicateProject: (project: Project) => void;
  onOpenProjectHub: () => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
}

export const ProjectMenu: React.FC<ProjectMenuProps> = ({
  projects,
  activeProject,
  dict,
  onSelectProject,
  onCreateProject,
  onDuplicateProject,
  onOpenProjectHub,
  onRenameProject,
  onDeleteProject,
}) => {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setRenamingId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setCreating(false);
        setRenamingId(null);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const submitCreate = () => {
    const trimmed = newName.trim() || dict.newProjectDefaultName;
    onCreateProject(trimmed);
    setNewName('');
    setCreating(false);
    setOpen(false);
  };

  const submitRename = (id: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) onRenameProject(id, trimmed);
    setRenamingId(null);
  };

  return (
    <div ref={wrapRef} className="popover-anchor">
      <button
        type="button"
        className="project-trigger"
        title={activeProject.name}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="project-trigger-name">{activeProject.name}</span>
        <ChevronDown size={15} className="muted-icon" />
      </button>

      {open && (
        <div className="popover-panel project-popover" role="menu">
          <button
            type="button"
            className="popover-action-btn"
            onClick={() => {
              setOpen(false);
              onOpenProjectHub();
            }}
          >
            <LayoutGrid size={15} />
            <span>{dict.homeAllProjects}</span>
          </button>
          <div className="popover-divider" />
          <div className="popover-section-label">{dict.projects}</div>
          <div className="project-list">
            {projects.map((p) => {
              const isActive = p.id === activeProject.id;
              const isRenaming = renamingId === p.id;
              return (
                <div
                  key={p.id}
                  className={`project-row ${isActive ? 'is-active' : ''}`}
                >
                  {isRenaming ? (
                    <form
                      className="project-inline-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        submitRename(p.id);
                      }}
                    >
                      <input
                        className="input-sm"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            setRenamingId(null);
                          }
                        }}
                      />
                      <button type="submit" className="icon-btn-sm" title="OK">
                        <Check size={14} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="project-row-main"
                        title={p.name}
                        onClick={() => {
                          onSelectProject(p.id);
                          setOpen(false);
                        }}
                      >
                        <span className={`project-dot ${isActive ? 'is-active' : ''}`} />
                        <span className="truncate">{p.name}</span>
                        <span className="project-count-pill">
                          {p.cards.filter((c) => !c.inbox && c.kind !== 'frame').length}
                        </span>
                      </button>
                      <div className="project-row-actions">
                        <button
                          type="button"
                          className="icon-btn-sm"
                          title={dict.homeDuplicateProject}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDuplicateProject(p);
                            setOpen(false);
                          }}
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn-sm"
                          title={dict.renameProject}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingId(p.id);
                            setRenameValue(p.name);
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                        {projects.length > 1 && (
                          <button
                            type="button"
                            className="icon-btn-sm icon-btn--danger"
                            title={dict.deleteProject}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteProject(p.id);
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="popover-divider" />

          {creating ? (
            <form
              className="project-create-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitCreate();
              }}
            >
              <input
                className="input-sm"
                placeholder={dict.newProjectDefaultName}
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setCreating(false);
                  }
                }}
              />
              <button type="submit" className="btn-xs btn-primary">
                {dict.createProject}
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="popover-action-btn"
              onClick={() => {
                setCreating(true);
                setNewName('');
              }}
            >
              <FolderPlus size={15} />
              <span>{dict.createProject}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
