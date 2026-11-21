import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FolderOpen,
  LayoutGrid,
  Pencil,
  Pin,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { Project, ProjectStatus } from '../../domain/types';
import {
  getTemplateTitleDesc,
  PROJECT_TEMPLATES,
  type ProjectTemplateId,
} from '../../domain/templates';
import { computeCardsBounds } from '../../domain/geometry';
import { resolveAssetUrl } from '../../storage/workspaceRepository';
import type { I18nDict } from '../../i18n';

interface ProjectHubOverlayProps {
  open: boolean;
  projects: Project[];
  activeProjectId: string;
  dict: I18nDict;
  onClose: () => void;
  onSelectProject: (id: string) => void;
  onCreateFromTemplate: (templateId: ProjectTemplateId, customName?: string) => void;
  onDuplicateProject: (project: Project) => void;
  onUpdateProjectMeta: (
    id: string,
    patch: Partial<Pick<Project, 'name' | 'status' | 'clientName' | 'projectCode' | 'pinned'>>
  ) => void;
  onDeleteProject: (id: string) => void;
  onExportMosaFile: (project: Project) => void;
  onOpenMosaFile: () => void;
}

const MiniBoardThumbnail: React.FC<{ project: Project }> = ({ project }) => {
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});

  const boardCards = useMemo(
    () => project.cards.filter((c) => !c.inbox && c.kind !== 'frame').slice(0, 18),
    [project.cards]
  );

  useEffect(() => {
    if (project.coverDataUrl) return;
    let alive = true;
    const imgCards = boardCards.filter((c) => c.kind === 'image' && c.assetId).slice(0, 6);
    Promise.all(
      imgCards.map(async (c) => {
        const url = c.assetId ? await resolveAssetUrl(c.assetId, 'thumb') : null;
        return [c.id, url || c.source?.imageUrl || ''] as const;
      })
    ).then((pairs) => {
      if (!alive) return;
      const map: Record<string, string> = {};
      for (const [id, url] of pairs) {
        if (url) map[id] = url;
      }
      setThumbUrls(map);
    });
    return () => {
      alive = false;
    };
  }, [boardCards, project.coverDataUrl]);

  if (project.coverDataUrl) {
    return (
      <div
        className="hub-card-thumb"
        style={{ background: project.appearance.background || '#F1F0EB' }}
      >
        <img src={project.coverDataUrl} alt={project.name} className="hub-card-thumb-img" />
      </div>
    );
  }

  const bounds = computeCardsBounds(boardCards);
  if (!bounds || boardCards.length === 0) {
    return (
      <div
        className="hub-card-thumb hub-card-thumb--empty"
        style={{ background: project.appearance.background || '#F1F0EB' }}
      >
        <LayoutGrid size={22} className="muted-icon" />
      </div>
    );
  }

  const pad = 40;
  const viewW = Math.max(1, bounds.w + pad * 2);
  const viewH = Math.max(1, bounds.h + pad * 2);
  const minX = bounds.x - pad;
  const minY = bounds.y - pad;

  return (
    <div
      className="hub-card-thumb"
      style={{ background: project.appearance.background || '#F1F0EB' }}
    >
      <div className="hub-mini-stage">
        {boardCards.map((c) => {
          const leftPct = ((c.x - minX) / viewW) * 100;
          const topPct = ((c.y - minY) / viewH) * 100;
          const wPct = Math.max(3, (c.w / viewW) * 100);
          const hPct = Math.max(4, (c.h / viewH) * 100);
          const imgSrc = c.kind === 'image' ? thumbUrls[c.id] || c.source?.imageUrl : undefined;
          const bg =
            c.kind === 'color'
              ? c.color || '#C5A47E'
              : c.kind === 'note'
                ? c.color || '#FFFDF7'
                : c.kind === 'image'
                  ? '#E5E5EA'
                  : '#FFFFFF';

          return (
            <div
              key={c.id}
              className="hub-mini-tile"
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${wPct}%`,
                height: `${hPct}%`,
                background: bg,
              }}
            >
              {imgSrc && (
                <img
                  src={imgSrc}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="hub-mini-tile-img"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const ProjectHubOverlay: React.FC<ProjectHubOverlayProps> = ({
  open,
  projects,
  activeProjectId,
  dict,
  onClose,
  onSelectProject,
  onCreateFromTemplate,
  onDuplicateProject,
  onUpdateProjectMeta,
  onDeleteProject,
  onExportMosaFile,
  onOpenMosaFile,
}) => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>('all');
  const [showTemplates, setShowTemplates] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editClient, setEditClient] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editStatus, setEditStatus] = useState<ProjectStatus>('draft');

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingId) {
          setEditingId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, editingId, onClose]);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...projects]
      .filter((p) => {
        const st: ProjectStatus = p.status ?? 'draft';
        if (statusFilter !== 'all' && st !== statusFilter) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.clientName || '').toLowerCase().includes(q) ||
          (p.projectCode || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [projects, query, statusFilter]);

  if (!open) return null;

  const statusLabel = (s: ProjectStatus) =>
    s === 'approved'
      ? dict.homeStatusApproved
      : s === 'review'
        ? dict.homeStatusReview
        : dict.homeStatusDraft;

  const startEdit = (p: Project) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditClient(p.clientName || '');
    setEditCode(p.projectCode || '');
    setEditStatus(p.status ?? 'draft');
  };

  const commitEdit = (id: string) => {
    onUpdateProjectMeta(id, {
      name: editName.trim() || dict.newProjectDefaultName,
      clientName: editClient.trim() || undefined,
      projectCode: editCode.trim() || undefined,
      status: editStatus,
    });
    setEditingId(null);
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  return (
    <div
      className="hub-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={dict.homeTitle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="hub-shell">
        {/* Header */}
        <div className="hub-header">
          <div className="hub-header-left">
            <img
              src={`${import.meta.env.BASE_URL}brand/logo.svg?v=6`}
              alt="Mosa"
              className="brand-logo"
            />
            <div>
              <div className="hub-brand-row">
                <span className="brand-name">{dict.appName}</span>
                <span className="hub-divider-dot">·</span>
                <span className="hub-subtitle">{dict.homeTitle}</span>
              </div>
            </div>
          </div>

          <div className="hub-header-actions">
            <button
              type="button"
              className="btn btn-subtle"
              onClick={() => {
                onOpenMosaFile();
              }}
            >
              <FolderOpen size={15} />
              <span>{dict.mosaFileOpenBtn}</span>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onCreateFromTemplate('blank');
                onClose();
              }}
            >
              <Plus size={15} />
              <span>{dict.homeNewProject}</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              title={dict.close}
              aria-label={dict.close}
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="hub-body">
          {/* Templates Strip */}
          <section className="hub-section">
            <div className="hub-section-head">
              <div className="hub-section-title">
                <Sparkles size={14} />
                <span>{dict.homeTemplatesHeading}</span>
              </div>
              <button
                type="button"
                className="btn-link-xs"
                onClick={() => setShowTemplates((v) => !v)}
              >
                {showTemplates ? '−' : '+'} {dict.homeTemplatesToggle}
              </button>
            </div>

            {showTemplates && (
              <div className="hub-template-grid">
                {PROJECT_TEMPLATES.map((tpl) => {
                  const info = getTemplateTitleDesc(tpl.id, dict);
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      className="hub-template-card"
                      onClick={() => {
                        onCreateFromTemplate(tpl.id);
                        onClose();
                      }}
                    >
                      <div className="hub-template-preview">
                        {tpl.previewSample ? (
                          <img src={tpl.previewSample} alt="" className="hub-template-img" />
                        ) : (
                          <div className="hub-template-blank">
                            <Plus size={20} />
                          </div>
                        )}
                        <div className="hub-template-swatches">
                          {tpl.accentColors.map((hex) => (
                            <span
                              key={hex}
                              className="hub-template-dot"
                              style={{ background: hex }}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="hub-template-info">
                        <strong>{info.title}</strong>
                        <span>{info.desc}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Search & Status Filters */}
          <section className="hub-section">
            <div className="hub-toolbar">
              <div className="hub-search-box">
                <Search size={15} className="muted-icon" />
                <input
                  className="hub-search-input"
                  placeholder={dict.homeSearchPlaceholder}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    className="icon-btn-sm"
                    onClick={() => setQuery('')}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <div className="hub-filter-pills">
                {(['all', 'draft', 'review', 'approved'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`hub-pill ${statusFilter === st ? 'is-active' : ''}`}
                    onClick={() => setStatusFilter(st)}
                  >
                    {st === 'all' ? dict.homeStatusAll : statusLabel(st)}
                  </button>
                ))}
              </div>
            </div>

            {filteredProjects.length === 0 ? (
              <div className="hub-empty">{dict.homeEmptySearch}</div>
            ) : (
              <div className="hub-project-grid">
                {filteredProjects.map((p) => {
                  const isActive = p.id === activeProjectId;
                  const isEditing = editingId === p.id;
                  const st: ProjectStatus = p.status ?? 'draft';
                  const cardCount = p.cards.filter((c) => !c.inbox && c.kind !== 'frame').length;

                  return (
                    <article
                      key={p.id}
                      className={`hub-project-card ${isActive ? 'is-active' : ''}`}
                    >
                      <div
                        className="hub-card-thumb-wrap"
                        onClick={() => {
                          if (!isEditing) {
                            onSelectProject(p.id);
                            onClose();
                          }
                        }}
                      >
                        <MiniBoardThumbnail project={p} />
                        <span className={`hub-status-badge hub-status-badge--${st}`}>
                          {statusLabel(st)}
                        </span>
                        {p.pinned && (
                          <span className="hub-pin-badge" title={dict.homePinProject}>
                            <Pin size={11} />
                          </span>
                        )}
                      </div>

                      {isEditing ? (
                        <form
                          className="hub-edit-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            commitEdit(p.id);
                          }}
                        >
                          <input
                            className="input-sm"
                            value={editName}
                            autoFocus
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder={dict.newProjectDefaultName}
                          />
                          <div className="hub-edit-row">
                            <input
                              className="input-sm"
                              value={editClient}
                              onChange={(e) => setEditClient(e.target.value)}
                              placeholder={dict.homeClientPlaceholder}
                            />
                            <input
                              className="input-sm"
                              style={{ width: 96, flexShrink: 0 }}
                              value={editCode}
                              onChange={(e) => setEditCode(e.target.value)}
                              placeholder={dict.homeProjectCodePlaceholder}
                            />
                          </div>
                          <div className="hub-edit-row">
                            <select
                              className="input-sm"
                              value={editStatus}
                              onChange={(e) => setEditStatus(e.target.value as ProjectStatus)}
                            >
                              <option value="draft">{dict.homeStatusDraft}</option>
                              <option value="review">{dict.homeStatusReview}</option>
                              <option value="approved">{dict.homeStatusApproved}</option>
                            </select>
                            <button type="submit" className="btn-xs btn-primary">
                              <Check size={13} />
                            </button>
                            <button
                              type="button"
                              className="btn-xs btn-subtle"
                              onClick={() => setEditingId(null)}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="hub-card-body">
                          <div
                            className="hub-card-main"
                            onClick={() => {
                              onSelectProject(p.id);
                              onClose();
                            }}
                          >
                            <h3 className="hub-card-title truncate" title={p.name}>
                              {p.name}
                            </h3>
                            <div className="hub-card-meta">
                              {p.clientName && (
                                <span className="truncate">{p.clientName}</span>
                              )}
                              {p.projectCode && <span className="mono">{p.projectCode}</span>}
                              <span>{dict.homeCardCount(cardCount)}</span>
                              <span>{formatDate(p.updatedAt)}</span>
                            </div>
                          </div>

                          <div className="hub-card-actions">
                            <button
                              type="button"
                              className="icon-btn-sm"
                              title={p.pinned ? dict.homeUnpinProject : dict.homePinProject}
                              onClick={() => onUpdateProjectMeta(p.id, { pinned: !p.pinned })}
                            >
                              <Pin size={13} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn-sm"
                              title={dict.homeEditMeta}
                              onClick={() => startEdit(p)}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn-sm"
                              title={dict.homeDuplicateProject}
                              onClick={() => onDuplicateProject(p)}
                            >
                              <Copy size={13} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn-sm"
                              title={dict.mosaFileSaveBtn}
                              onClick={() => onExportMosaFile(p)}
                            >
                              <Download size={13} />
                            </button>
                            {projects.length > 1 && (
                              <button
                                type="button"
                                className="icon-btn-sm icon-btn--danger"
                                title={dict.deleteProject}
                                onClick={() => onDeleteProject(p.id)}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
