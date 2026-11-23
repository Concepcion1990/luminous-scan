import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageCircle, MessagesSquare, Mic, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useBusiness } from '@/hooks/useBusiness';
import { t } from '@/lib/i18n';
import { formatShortDate, formatTimeOnly } from '@/lib/dates';
import { initialsOf } from '@/lib/profilePhotos';
import { buildVoiceWav, createPcmCapture } from '@/lib/voiceCapture';
import { cn } from '@/lib/utils';
import {
  getXstoreThread,
  listXstorePeople,
  listXstoreThreads,
  markXstoreThreadRead,
  postXstoreMessage,
  postXstoreVoiceMessage,
  startXstoreThread,
  xstorePhotoFileUrl,
  xstoreVoiceNoteFileUrl,
} from '@/lib/xstore';

/**
 * Cross-store messages (the owner's second messaging door,
 * Nov 23, 2026): everyone on this account, across all the
 * owner's businesses, in one inbox. Separate from the
 * in-store Messages in Workforce — those stay scoped to the
 * store you are standing in; this door is scoped to the
 * account. Business-only: the route is wrapped in
 * PlanRedirect and the server refuses Essentials on every
 * call, so the door leaves no trace there.
 *
 * The conversation carries what she asked for: each person's
 * approved profile photo beside their messages (initials
 * when they have none), the date and time on every message,
 * Delivered and Read marks under your own messages, and
 * voice notes through the same sample-counted capture the
 * in-store inbox uses (src/lib/voiceCapture.js) — the server
 * converts to MP3 exactly as there.
 */

const MESSAGE_MAX_CHARS = 2000;
const MESSAGE_COUNTER_FROM = 1500;
const VOICE_MAX_MS = 3 * 60 * 1000;

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';
const labelCls = 'mb-1 block text-xs font-medium text-muted-foreground';

function formatDay(value) {
  return formatShortDate(value);
}
function formatTime(value) {
  return formatTimeOnly(value);
}

/** A person's face in this door: their APPROVED profile photo
 * served by the account photo route, or their initials. A
 * pending photo is never rendered — the server only ever
 * reports approved state and only ever serves approved bytes. */
function XAvatar({ businessId, person, className }) {
  if (person?.photo) {
    return (
      <img
        src={xstorePhotoFileUrl(businessId, person.user_id)}
        alt=""
        aria-hidden="true"
        className={cn('shrink-0 rounded-full object-cover', className || 'h-8 w-8')}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground',
        className || 'h-8 w-8 text-xs',
      )}
    >
      {initialsOf(person?.name)}
    </span>
  );
}

function businessLine(person) {
  return (person?.businesses ?? []).map((b) => b.name).filter(Boolean).join(' · ');
}

export default function CrossStoreMessages() {
  const { activeId } = useBusiness();
  const businessId = activeId || '';
  const { toast } = useToast();
  const [people, setPeople] = useState([]);
  const [meUserId, setMeUserId] = useState(null);
  const [threads, setThreads] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadPeople = useCallback(async () => {
    const data = await listXstorePeople(businessId);
    setPeople(data.people ?? []);
    setMeUserId(data.me_user_id ?? null);
  }, [businessId]);
  const loadThreads = useCallback(async () => {
    const data = await listXstoreThreads(businessId);
    setThreads(data.threads ?? []);
  }, [businessId]);
  useEffect(() => {
    if (!businessId) return;
    Promise.all([loadPeople(), loadThreads()])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId, loadPeople, loadThreads]);

  const openThread = async (thread) => {
    try {
      discardRecording();
      const data = await getXstoreThread(businessId, thread.id);
      setActiveThread(data.thread);
      setThreadMessages(data.messages ?? []);
      setDraft('');
      if ((thread.unread ?? 0) > 0) {
        await markXstoreThreadRead(businessId, thread.id).catch(() => {});
        await loadThreads();
      }
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    }
  };

  const startConversation = async () => {
    if (!pickerTarget) return;
    setBusy(true);
    try {
      const data = await startXstoreThread(businessId, pickerTarget);
      setPickerOpen(false);
      setPickerTarget('');
      await loadThreads();
      await openThread(data.thread);
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeThread) return;
    setBusy(true);
    try {
      await postXstoreMessage(businessId, activeThread.id, body);
      setDraft('');
      const data = await getXstoreThread(businessId, activeThread.id);
      setActiveThread(data.thread);
      setThreadMessages(data.messages ?? []);
      await loadThreads();
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  // ---- Voice notes ---------------------------------------------------------
  // The in-store composer's pattern, unchanged: sample-counted
  // PCM capture first (a container clock is never trusted with
  // a note's timing), the device recorder only as the fallback,
  // listen back before sending. The server converts to MP3 so
  // the note plays on the other person's phone, whatever kind
  // it is. 3 minutes is the composer's cap.
  const [recPhase, setRecPhase] = useState('idle'); // idle | recording | ready
  const [recElapsedMs, setRecElapsedMs] = useState(0);
  const [recPreviewUrl, setRecPreviewUrl] = useState(null);
  const recRef = useRef({ recorder: null, capture: null, stream: null, chunks: [], timer: null, startedAt: 0, blob: null, durationMs: 0 });

  const stopRecTracks = useCallback(() => {
    const rec = recRef.current;
    if (rec.timer) clearInterval(rec.timer);
    rec.timer = null;
    if (rec.capture) rec.capture.dispose();
    rec.capture = null;
    if (rec.stream) rec.stream.getTracks().forEach((track) => track.stop());
    rec.stream = null;
  }, []);

  const discardRecording = useCallback(() => {
    stopRecTracks();
    recRef.current.blob = null;
    if (recPreviewUrl) URL.revokeObjectURL(recPreviewUrl);
    setRecPreviewUrl(null);
    setRecElapsedMs(0);
    setRecPhase('idle');
  }, [recPreviewUrl, stopRecTracks]);

  useEffect(() => () => {
    stopRecTracks();
    if (recPreviewUrl) URL.revokeObjectURL(recPreviewUrl);
  }, [recPreviewUrl, stopRecTracks]);

  const stopRecording = () => {
    const rec = recRef.current;
    if (rec.capture) {
      const { samples, sampleRate } = rec.capture.finish();
      rec.capture = null;
      const wav = buildVoiceWav(samples, sampleRate);
      rec.blob = new Blob([wav.bytes], { type: 'audio/wav' });
      rec.durationMs = wav.durationMs;
      stopRecTracks();
      setRecPreviewUrl(URL.createObjectURL(rec.blob));
      setRecPhase('ready');
      return;
    }
    if (rec.recorder?.state === 'recording') rec.recorder.stop();
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ title: t('workforce.messages.micDenied'), variant: 'destructive' });
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast({ title: t('workforce.messages.micDenied'), variant: 'destructive' });
      return;
    }
    const rec = recRef.current;
    rec.stream = stream;
    rec.startedAt = Date.now();

    const armTimer = () => {
      setRecElapsedMs(0);
      setRecPhase('recording');
      rec.timer = setInterval(() => {
        const elapsed = rec.capture
          ? (rec.capture.sampleCount() / rec.capture.sampleRate) * 1000
          : Date.now() - rec.startedAt;
        setRecElapsedMs(elapsed);
        if (elapsed >= VOICE_MAX_MS) stopRecording();
      }, 250);
    };

    try {
      const capture = createPcmCapture(stream);
      await capture.begin();
      rec.capture = capture;
      armTimer();
      return;
    } catch {
      rec.capture = null;
    }

    if (typeof MediaRecorder === 'undefined') {
      stopRecTracks();
      toast({ title: t('workforce.messages.micDenied'), variant: 'destructive' });
      return;
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', '']
      .find((candidate) => candidate === '' || MediaRecorder.isTypeSupported(candidate));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    rec.recorder = recorder;
    rec.chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data?.size) rec.chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(rec.chunks, { type: recorder.mimeType || 'audio/webm' });
      rec.blob = blob;
      rec.durationMs = Date.now() - rec.startedAt;
      stopRecTracks();
      setRecPreviewUrl(URL.createObjectURL(blob));
      setRecPhase('ready');
    };
    recorder.start();
    armTimer();
  };

  const sendVoice = async () => {
    const blob = recRef.current.blob;
    if (!blob || !activeThread) return;
    setBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      await postXstoreVoiceMessage(businessId, activeThread.id, dataUrl, recRef.current.durationMs);
      discardRecording();
      const data = await getXstoreThread(businessId, activeThread.id);
      setActiveThread(data.thread);
      setThreadMessages(data.messages ?? []);
      await loadThreads();
    } catch (error) {
      toast({ title: error.message || t('workforce.messages.voiceFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const recClock = `${Math.floor(recElapsedMs / 60000)}:${String(Math.floor((recElapsedMs % 60000) / 1000)).padStart(2, '0')}`;
  const pickerPeople = people.filter((p) => p.user_id !== meUserId);
  const personById = new Map(people.map((p) => [p.user_id, p]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold sm:text-[28px]">{t('xstore.title')}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('xstore.help')}</p>
      </div>

      {loading ? null : !activeThread ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPickerOpen((open) => !open)}>
              <MessageCircle className="mr-1.5 h-4 w-4" /> {t('workforce.messages.new')}
            </Button>
          </div>
          {pickerOpen && (
            <div className="flex max-w-xl flex-wrap items-end gap-2 rounded-lg bg-muted/50 p-3">
              <div className="min-w-48 flex-1">
                <label className={labelCls}>{t('workforce.messages.to')}</label>
                {pickerPeople.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">{t('xstore.noPeople')}</p>
                ) : (
                  <select className={inputCls} value={pickerTarget} onChange={(e) => setPickerTarget(e.target.value)}>
                    <option value="">{t('workforce.messages.selectPerson')}</option>
                    {pickerPeople.map((p) => (
                      <option key={p.user_id} value={p.user_id}>
                        {p.name}
                        {businessLine(p) ? ` — ${businessLine(p)}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <Button size="sm" disabled={busy || !pickerTarget} onClick={startConversation}>
                {t('workforce.messages.start')}
              </Button>
            </div>
          )}
          {threads.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('xstore.empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 py-3.5 text-left text-sm"
                    onClick={() => openThread(thread)}
                  >
                    {thread.other ? (
                      <XAvatar businessId={businessId} person={thread.other} className="h-9 w-9 text-xs" />
                    ) : (
                      <MessagesSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{thread.other?.name ?? ''}</span>
                      {thread.other && businessLine(thread.other) ? (
                        <span className="block truncate text-xs text-muted-foreground">{businessLine(thread.other)}</span>
                      ) : null}
                      <span className="block truncate text-xs text-muted-foreground">
                        {thread.last_message
                          ? `${thread.last_message.sender_name}: ${thread.last_message.kind === 'voice' ? t('workforce.messages.voiceNote') : thread.last_message.body}`
                          : t('workforce.messages.emptyThread')}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      {thread.last_message_at && (
                        <span className="text-xs text-muted-foreground">
                          {formatDay(thread.last_message_at)} {formatTime(thread.last_message_at)}
                        </span>
                      )}
                      {thread.last_message && (
                        <span className="text-[11px] font-medium text-muted-foreground">
                          {thread.last_message.mine
                            ? t('workforce.messages.sentLabel')
                            : t('workforce.messages.receivedLabel')}
                        </span>
                      )}
                    </span>
                    {(thread.unread ?? 0) > 0 && (
                      <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                        {thread.unread}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div>
          <div className="mb-4 flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setActiveThread(null)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> {t('workforce.messages.back')}
            </Button>
            {activeThread.other ? (
              <XAvatar businessId={businessId} person={activeThread.other} className="h-8 w-8 text-[11px]" />
            ) : null}
            <span className="text-sm font-medium">{activeThread.other?.name ?? ''}</span>
            {activeThread.other && businessLine(activeThread.other) ? (
              <span className="text-xs text-muted-foreground">{businessLine(activeThread.other)}</span>
            ) : null}
          </div>
          {threadMessages.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t('workforce.messages.emptyThread')}</p>
          ) : (
            <ul className="space-y-3 py-1">
              {threadMessages.map((message) => {
                const sender = personById.get(message.sender_user_id)
                  ?? (activeThread.participants ?? []).find((p) => p.user_id === message.sender_user_id);
                return (
                  <li key={message.id} className={`flex items-end gap-2 ${message.mine ? 'justify-end' : 'justify-start'}`}>
                    {!message.mine && sender ? (
                      <XAvatar businessId={businessId} person={sender} className="h-7 w-7 text-[10px]" />
                    ) : null}
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        message.mine
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground'
                      }`}
                    >
                      {!message.mine && (
                        <span className="mb-0.5 block text-xs font-medium opacity-70">{message.sender_name}</span>
                      )}
                      {message.kind === 'voice' ? (
                        <span className="block">
                          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium opacity-80">
                            <Mic className="h-3.5 w-3.5" /> {t('workforce.messages.voiceNote')}
                          </span>
                          <audio
                            controls
                            preload="metadata"
                            src={xstoreVoiceNoteFileUrl(businessId, message.thread_id, message.id)}
                            className="h-9 max-w-full"
                          />
                        </span>
                      ) : (
                        <span className="whitespace-pre-wrap">{message.body}</span>
                      )}
                      <span className="mt-1 block text-[11px] opacity-60">
                        {formatDay(message.created_at)} {formatTime(message.created_at)}
                        {message.mine && message.read_at
                          ? ` · ${t('workforce.messages.readLabel')}`
                          : message.mine && message.delivered_at
                            ? ` · ${t('xstore.deliveredLabel')}`
                            : ''}
                      </span>
                    </div>
                    {message.mine && sender ? (
                      <XAvatar businessId={businessId} person={sender} className="h-7 w-7 text-[10px]" />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-5 space-y-3">
            {recPhase === 'recording' && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                  {t('workforce.messages.recording')} {recClock}
                </span>
                <Button size="sm" variant="outline" className="ml-auto" onClick={stopRecording}>
                  {t('workforce.messages.stopRecording')}
                </Button>
              </div>
            )}
            {recPhase === 'ready' && (
              <div className="space-y-2 rounded-lg bg-muted/50 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">{t('workforce.messages.voiceReady')}</p>
                <audio controls src={recPreviewUrl} className="h-9 w-full max-w-sm" />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={sendVoice}>
                    <Send className="mr-1.5 h-4 w-4" /> {t('workforce.messages.sendVoice')}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={discardRecording}>
                    <Trash2 className="mr-1.5 h-4 w-4" /> {t('workforce.messages.discard')}
                  </Button>
                </div>
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <textarea
                  className={inputCls}
                  rows={2}
                  maxLength={MESSAGE_MAX_CHARS}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('workforce.messages.placeholder')}
                />
                {draft.length >= MESSAGE_COUNTER_FROM && (
                  <p
                    className={`mt-1 text-right text-xs ${
                      draft.length >= MESSAGE_MAX_CHARS
                        ? 'font-medium text-destructive'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {draft.length >= MESSAGE_MAX_CHARS
                      ? t('workforce.messages.charLimit')
                      : t('workforce.messages.charCount', { count: draft.length, max: MESSAGE_MAX_CHARS })}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                disabled={busy || recPhase !== 'idle'}
                onClick={startRecording}
                aria-label={t('workforce.messages.voiceNote')}
                title={t('workforce.messages.voiceNote')}
              >
                <Mic className="h-4 w-4" />
              </Button>
              <Button disabled={busy || !draft.trim()} onClick={send}>
                <Send className="mr-1.5 h-4 w-4" /> {t('workforce.messages.send')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
