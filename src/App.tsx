import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { io, type Socket } from "socket.io-client";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Crown,
  Eye,
  History,
  Info,
  Lightbulb,
  LogOut,
  Moon,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from "lucide-react";
import type {
  Account,
  Card,
  GameState,
  Mode,
  Personality,
  Play,
  RoomCommand,
  RoomView,
} from "../shared/types.ts";
import { PERSONALITIES } from "../shared/types.ts";
import { formatTokens, rankText, sortCards } from "../shared/cards.ts";
import { beats, bombLevel, interpret, playName } from "../shared/rules.ts";
import { CardFace, Hand, Modal } from "./components.tsx";

type Theme = "light" | "dark";
type Replay = {
  game: GameState;
  players: ({ id: string; name: string } | null)[];
  reason: string;
  kind: string;
  mode: Mode;
};
type HistoryRow = {
  id: string;
  mode: Mode;
  kind: string;
  at: number;
  delta: string;
  won: boolean;
};
const saved = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage may be unavailable. */
  }
};
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "请求失败");
  return result;
}
const heroCards: Card[] = [
  { id: "heroQ", rank: 12, suit: "C" },
  { id: "heroA", rank: 14, suit: "S" },
  { id: "hero8", rank: 8, suit: "H" },
];

export default function App() {
  const [mode, setMode] = useState<Mode>(
    () => saved("clear-mode", "standard") as Mode,
  );
  const [theme, setTheme] = useState<Theme>(
    () =>
      (saved("clear-theme", "") ||
        (saved("clear-mode", "standard") === "wild"
          ? "dark"
          : "light")) as Theme,
  );
  const [account, setAccount] = useState<Account | null>(null),
    [room, setRoom] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [personas, setPersonas] = useState<Personality[]>(["cautious", "bold"]),
    [code, setCode] = useState("");
  const [modal, setModal] = useState<
    | "rules"
    | "settings"
    | "nickname"
    | "history"
    | "multiplier"
    | "spectators"
    | "leave"
    | "result"
    | "relief"
    | "replay"
    | null
  >(null);
  const [history, setHistory] = useState<HistoryRow[]>([]),
    [replay, setReplay] = useState<Replay | null>(null),
    [step, setStep] = useState(-1);
  const [selected, setSelected] = useState<string[]>([]),
    [choices, setChoices] = useState<Play[] | null>(null),
    [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(
      () => saved("clear-sound", "off") === "on",
    ),
    [relief, setRelief] = useState<{ id: string; question: string } | null>(
      null,
    ),
    [answer, setAnswer] = useState("");
  const [nickname, setNickname] = useState("");
  const socket = useRef<Socket | null>(null),
    roomRef = useRef<RoomView | null>(null),
    seenResult = useRef(""),
    audio = useRef<AudioContext | null>(null);
  const closeModal = useCallback(() => setModal(null), []);
  const acceptRoom = useCallback((next: RoomView | null) => {
    setRoom((current) => {
      if (next && current?.code === next.code && current.version > next.version)
        return current;
      roomRef.current = next;
      return next;
    });
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "light" ? "#eaf0f4" : "#101f2c");
  }, [theme]);
  useEffect(() => {
    if (!saved("clear-theme", ""))
      setTheme((room?.mode ?? mode) === "wild" ? "dark" : "light");
  }, [mode, room?.mode]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!error && !notice) return;
    const timer = setTimeout(() => {
      setError("");
      setNotice("");
    }, 6500);
    return () => clearTimeout(timer);
  }, [error, notice]);
  useEffect(() => {
    let disposed = false;
    api<{ account: Account }>("/session", "POST")
      .then(({ account }) => {
        if (disposed) return;
        setAccount(account);
        setNickname(account.name);
        const connection = io({ autoConnect: false });
        socket.current = connection;
        connection.on("connect", () => {
          setConnected(true);
          api<Account>("/me")
            .then(setAccount)
            .catch(() => {});
        });
        connection.on("disconnect", () => setConnected(false));
        connection.on("connect_error", () => {
          setConnected(false);
          setError("连接暂时中断，正在重试");
        });
        connection.on("room", acceptRoom);
        connection.on("account", setAccount);
        connection.connect();
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
      socket.current?.disconnect();
    };
  }, [acceptRoom]);
  useEffect(() => {
    const ids = new Set(room?.game?.hand.map((c) => c.id));
    setSelected((s) => s.filter((id) => ids.has(id)));
    setChoices(null);
    if (room?.result && seenResult.current !== room.result.replayId) {
      seenResult.current = room.result.replayId;
      setModal("result");
      api<Account>("/me")
        .then(setAccount)
        .catch(() => {});
    }
  }, [
    room?.game?.id,
    room?.game?.hand.map((c) => c.id).join(","),
    room?.result?.replayId,
  ]);
  const lastPlay = room?.game?.events.filter((e) => e.play).at(-1)?.index;
  const lastEvent = room?.game?.events.at(-1);
  const lastMultiplier = room?.game?.multiplierEvents.at(-1);
  useEffect(() => {
    if (!sound || lastPlay === undefined) return;
    try {
      const ctx = audio.current ?? new AudioContext();
      audio.current = ctx;
      if (ctx.state !== "running") return;
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.frequency.setValueAtTime(420, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(170, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {}
  }, [lastPlay, sound]);
  async function send(event: string, data: unknown) {
    if (!socket.current?.connected) throw new Error("尚未连接，请稍候");
    return await new Promise<any>((resolve, reject) =>
      socket
        .current!.timeout(8000)
        .emit(event, data, (err: Error | null, result: any) => {
          if (err) reject(new Error("请求超时，请检查网络后重试"));
          else if (!result?.ok) reject(new Error(result?.error ?? "操作失败"));
          else resolve(result);
        }),
    );
  }
  async function perform(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function editNickname() {
    setNickname(account?.name ?? "");
    setModal("nickname");
  }
  function nicknameButton() {
    return (
      <button
        className="profile-button"
        aria-label="修改昵称"
        title={`修改昵称：${account?.name ?? ""}`}
        disabled={!account || busy}
        onClick={editNickname}
      >
        <span className="profile-label">昵称</span>
        <span className="profile-name">{account?.name ?? "正在连接…"}</span>
        <Pencil size={13} />
      </button>
    );
  }
  async function saveNickname() {
    await perform(async () => {
      const updated = await api<Account>("/me", "PATCH", { name: nickname });
      setAccount(updated);
      setNickname(updated.name);
      if (modal === "nickname") closeModal();
      setNotice("昵称已保存");
    });
  }
  async function command(command: RoomCommand) {
    await perform(async () => {
      const result = await send("room.command", {
        version: roomRef.current?.version,
        id: crypto.randomUUID(),
        command,
      });
      if ("room" in result) acceptRoom(result.room);
      if (result.account) setAccount(result.account);
    });
  }
  function changeMode(next: Mode) {
    setMode(next);
    save("clear-mode", next);
    if (!saved("clear-theme", "")) setTheme(next === "wild" ? "dark" : "light");
  }
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    save("clear-theme", next);
  }
  const create = (kind: "pve" | "pvp") =>
    perform(async () => {
      const result = await send("room.create", {
        mode,
        kind,
        personalities: personas,
      });
      acceptRoom(result.room);
    });
  const join = () =>
    perform(async () => {
      const result = await send("room.join", { code });
      acceptRoom(result.room);
    });
  const showHistory = () =>
    perform(async () => {
      setHistory(await api("/history"));
      setModal("history");
    });
  const showReplay = (id: string) =>
    perform(async () => {
      setReplay(await api("/replays/" + id));
      setStep(-1);
      setModal("replay");
    });
  const openRelief = () =>
    perform(async () => {
      setRelief(await api("/relief", "POST"));
      setAnswer("");
      setModal("relief");
    });
  const game = room?.game,
    live = !!game && !["finished", "redeal"].includes(game.phase),
    mySeat = room?.mySeat ?? -1;
  const myTurn = !!game && game.turn === mySeat && !room?.pausedUntil;
  const hand = game?.hand ?? [];
  const interpretations = useMemo(
    () =>
      interpret(
        hand.filter((c) => selected.includes(c.id)),
        game?.wildRank ?? null,
      ).filter((p) => beats(p, game?.trick?.play ?? null)),
    [selected, hand, game?.wildRank, game?.trick],
  );
  const submitPlay = (p: Play) => {
    setChoices(null);
    void command({
      type: "game",
      action: { type: "play", cardIds: p.cards.map((c) => c.id), as: p.as },
    });
  };
  const playSelected = () => {
    if (interpretations.length === 1) submitPlay(interpretations[0]);
    else if (interpretations.length > 1) setChoices(interpretations);
    else setError("所选牌型无效，或不能压过上一手");
  };
  const countdown = Math.max(
    0,
    Math.ceil(((room?.pausedUntil ?? room?.deadline ?? now) - now) / 1000),
  );
  const baseSeat = mySeat < 0 ? 0 : mySeat,
    leftSeat = (baseSeat + 2) % 3,
    rightSeat = (baseSeat + 1) % 3;
  function seatCard(index: number, position: string) {
    const p = room!.seats[index],
      landlord = game?.landlord === index,
      activeTurn = live && game?.turn === index && game.phase !== "doubling";
    return (
      <div
        className={`seat seat-${position} ${activeTurn ? "active-seat" : ""}`}
      >
        {p ? (
          <>
            <div className={`avatar ${landlord ? "landlord-avatar" : ""}`}>
              {Array.from(p.name)[0]}
              {landlord && <Crown size={13} className="crown" />}
            </div>
            <div className="seat-info">
              <div className="seat-name">
                <span className="seat-player-name" title={p.name}>
                  {p.name}
                </span>
                {index === mySeat && <span className="you-label">你</span>}
              </div>
              <span className="seat-caption">
                {!p.connected
                  ? "等待重连"
                  : live
                    ? `${landlord ? "地主" : game!.landlord < 0 ? "等待叫抢" : "农民"}${p.bot ? " · " + PERSONALITIES[p.bot].name : ""}`
                    : p.ready
                      ? "已准备"
                      : p.bot
                        ? PERSONALITIES[p.bot].name
                        : "等待准备"}
              </span>
            </div>
            {live && (
              <span className="remaining-cards">
                <span className="mini-card-back" />
                {p.count}
              </span>
            )}
            {!live && p.ready && <Check size={18} className="ready-mark" />}
            {activeTurn && <span className="turn-timer">{countdown}s</span>}
          </>
        ) : (
          <button
            className="empty-seat"
            onClick={() => void command({ type: "sit", seat: index })}
            disabled={busy || mySeat >= 0}
          >
            <Plus size={20} />
            <span>空座 · 坐下</span>
          </button>
        )}
      </div>
    );
  }
  function tablePlay(index: number) {
    const last = game?.lastPlays[index];
    if (!last) return null;
    return (
      <div
        className={`table-play ${game?.trick?.seat === index ? "current-play" : ""} play-${index === baseSeat ? "self" : index === leftSeat ? "left" : "right"}`}
        key={`${index}-${last.text}-${last.play?.cards.map((c) => c.id).join("")}`}
      >
        {last.play ? (
          <>
            <span className="played-label">
              {game?.trick?.seat === index ? "当前 · " : ""}
              {playName(last.play)}
            </span>
            <div
              className="played-cards"
              style={{ "--count": last.play.cards.length } as CSSProperties}
            >
              {last.play.cards.map((card, i) => (
                <CardFace
                  key={card.id}
                  card={card}
                  as={last.play!.as[i]}
                  small
                  wild={card.rank === game?.wildRank}
                />
              ))}
            </div>
          </>
        ) : (
          <span className="pass-label">不出</span>
        )}
      </div>
    );
  }
  const pairMultiplier = (farmer: number) =>
    BigInt(game?.multiplier ?? "15") *
    BigInt(game?.doubles[game.landlord] ?? 1) *
    BigInt(game?.doubles[farmer] ?? 1);

  return (
    <div className={`app ${room ? "in-room" : "in-lobby"}`}>
      <header className="app-header">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            if (room) setModal("leave");
          }}
          aria-label="Darwin斗地主主页"
        >
          <span className="brand-symbol">
            <span />
            <span />
            <span />
          </span>
          <span>
            Darwin斗地主<small>THREE PLAYERS. ONE TABLE.</small>
          </span>
        </a>
        <div className="header-tools">
          <button
            className="text-button desktop-only"
            onClick={() => setModal("rules")}
          >
            玩法说明 <ArrowRight size={14} />
          </button>
          <button
            className="wallet"
            title={account ? `${account.balance} Tokens` : ""}
            onClick={() =>
              account?.balance === "0"
                ? void openRelief()
                : setNotice(`当前余额 ${account?.balance ?? "…"} Tokens`)
            }
          >
            <span className="token-symbol">T</span>
            <span>
              {formatTokens(account?.balance ?? "0")}
              <small>Tokens</small>
            </span>
            {account?.balance === "0" && <Plus size={15} />}
          </button>
          <span className="header-divider" />
          <button
            className="icon-button"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"}
          >
            {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
          </button>
          <button
            className="icon-button"
            onClick={() => {
              setNickname(account?.name ?? "");
              setModal("settings");
            }}
            aria-label="设置"
          >
            <Settings2 size={19} />
          </button>
        </div>
      </header>

      {!room ? (
        <main className="lobby-main">
          <div className="lobby-intro">
            <div>
              <p className="eyebrow">三人对弈 · 自有节奏</p>
              <h1>
                落座，开局<span>。</span>
              </h1>
              <p className="intro-copy">
                与好友见招拆招，或与不同性格的对手练一手。
              </p>
              <div className="lobby-profile">{nicknameButton()}</div>
            </div>
            <div className="mode-selector" role="group" aria-label="玩法模式">
              <button
                className={mode === "standard" ? "selected-mode" : ""}
                aria-pressed={mode === "standard"}
                onClick={() => changeMode("standard")}
              >
                标准玩法
              </button>
              <button
                className={mode === "wild" ? "selected-mode" : ""}
                aria-pressed={mode === "wild"}
                onClick={() => changeMode("wild")}
              >
                <Sparkles size={14} />
                癞子玩法
              </button>
            </div>
          </div>
          <div className="lobby-grid">
            <section className="table-hero" aria-label="现代纸牌和液态玻璃牌桌">
              <span className="hero-tag">
                <span className="status-dot" />
                {mode === "standard" ? "经典三人斗地主" : "四癞子 · 更多可能"}
              </span>
              <div className="hero-orbit orbit-one" />
              <div className="hero-orbit orbit-two" />
              <div className="hero-glass">
                <span className="table-engraving">DARWIN</span>
              </div>
              <div className={`hero-fan ${mode === "wild" ? "wild-fan" : ""}`}>
                {heroCards.map((card, i) => (
                  <div className={`hero-card hero-card-${i}`} key={card.id}>
                    <CardFace card={card} wild={mode === "wild" && i === 2} />
                  </div>
                ))}
              </div>
              <div className="hero-caption">
                <span>一副牌，三个人。</span>
                <span>每一手，都有新可能。</span>
              </div>
              <div className="table-spec">
                <span>
                  底注 <b>10 Tokens</b>
                </span>
                <span>
                  起始 <b>×15</b>
                </span>
                <button
                  onClick={() => setModal("rules")}
                  aria-label="查看倍率规则"
                >
                  <Info size={16} />
                </button>
              </div>
            </section>
            <section className="play-options">
              <div className="practice-section">
                <div className="section-heading">
                  <span className="section-icon">
                    <Sparkles size={21} />
                  </span>
                  <div>
                    <h2>人机练习</h2>
                    <p>两位对手，两种出牌性格</p>
                  </div>
                </div>
                <div className="personality-fields">
                  {[0, 1].map((i) => (
                    <label className="personality-field" key={i}>
                      <span className={`small-avatar persona-${i}`}>
                        {i === 0 ? "澜" : "山"}
                      </span>
                      <span className="personality-name">
                        {i === 0 ? "听澜" : "见山"}
                        <small>{PERSONALITIES[personas[i]].description}</small>
                      </span>
                      <select
                        aria-label={`对手${i + 1}人格`}
                        value={personas[i]}
                        onChange={(e) =>
                          setPersonas((p) =>
                            p.map((v, j) =>
                              j === i ? (e.target.value as Personality) : v,
                            ),
                          )
                        }
                      >
                        {Object.entries(PERSONALITIES).map(([key, v]) => (
                          <option value={key} key={key}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <button
                  className="primary-button start-button"
                  onClick={() => void create("pve")}
                  disabled={busy || !connected}
                >
                  开始练习 <ArrowRight size={19} />
                </button>
                <p className="subtle-caption">
                  同等棋力，不同性格 · 支持赛后复盘
                </p>
              </div>
              <div className="friends-section">
                <div className="section-heading">
                  <span className="section-icon">
                    <Users size={21} />
                  </span>
                  <div>
                    <h2>好友对局</h2>
                    <p>一个房间码，就能坐到一起</p>
                  </div>
                </div>
                <button
                  className="secondary-button create-room-button"
                  disabled={busy || !connected}
                  onClick={() => void create("pvp")}
                >
                  <Plus size={17} />
                  创建房间
                  <ChevronRight size={16} />
                </button>
                <form
                  className="join-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void join();
                  }}
                >
                  <input
                    aria-label="六位房间码"
                    placeholder="输入 6 位房间码"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  />
                  <button
                    aria-label="加入房间"
                    disabled={code.length !== 6 || busy || !connected}
                  >
                    <ArrowRight size={19} />
                  </button>
                </form>
              </div>
            </section>
          </div>
          <footer className="lobby-footer">
            <span className="connection-caption">
              <span className={`status-dot ${connected ? "" : "offline"}`} />
              {connected ? "牌桌已就绪" : "正在连接牌桌…"}
            </span>
            <button className="text-button" onClick={() => void showHistory()}>
              <History size={15} />
              最近对局 <ArrowRight size={14} />
            </button>
          </footer>
        </main>
      ) : (
        <main className="room-main">
          <div className="room-toolbar">
            <button className="text-button" onClick={() => setModal("leave")}>
              <ArrowLeft size={17} />
              <span className="desktop-only">离开牌桌</span>
            </button>
            <div className="room-title">
              <span>{room.kind === "pve" ? "人机练习" : "好友对局"}</span>
              <span className="mode-pill">
                {room.mode === "wild" ? "癞子" : "标准"}
              </span>
              {room.kind === "pvp" && (
                <button
                  className="code-button"
                  title="复制房间码"
                  onClick={() =>
                    void perform(async () => {
                      await navigator.clipboard.writeText(room.code);
                      setNotice("房间码已复制");
                    })
                  }
                >
                  {room.code}
                  <Copy size={12} />
                </button>
              )}
            </div>
            <div className="room-tools">
              <button
                className="text-button"
                onClick={() => setModal("spectators")}
                aria-label="查看观众"
              >
                <Eye size={16} />
                {room.spectators.length}
              </button>
              <button
                className="icon-button"
                aria-label={sound ? "关闭音效" : "开启音效"}
                onClick={() => {
                  const next = !sound;
                  setSound(next);
                  save("clear-sound", next ? "on" : "off");
                  if (next) {
                    audio.current ??= new AudioContext();
                    void audio.current.resume();
                  }
                }}
              >
                {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
              </button>
            </div>
          </div>
          <section
            className={`game-stage ${live ? "live-stage" : "waiting-stage"}`}
          >
            <div className="felt-glass">
              <div className="felt-inner" />
              <span className="felt-watermark">
                Darwin斗地主<span>DARWIN</span>
              </span>
            </div>
            {live && lastEvent?.play && bombLevel(lastEvent.play) > 0 && (
              <div
                className="bomb-ripple"
                key={`bomb-${lastEvent.index}`}
                aria-hidden="true"
              />
            )}
            {live && lastMultiplier && lastMultiplier.factor > 1 && (
              <div
                className="multiplier-cue"
                key={game!.multiplierEvents.length}
              >
                {lastMultiplier.reason} ×{lastMultiplier.factor}
              </div>
            )}
            {live && (
              <div className="table-top-info">
                <div className="bottom-cards">
                  {game!.bottom.length
                    ? game!.bottom.map((c) => (
                        <CardFace key={c.id} card={c} small />
                      ))
                    : [0, 1, 2].map((i) => (
                        <span key={i} className="bottom-back">
                          ✧
                        </span>
                      ))}
                </div>
                <button
                  className="multiplier"
                  onClick={() => setModal("multiplier")}
                >
                  <small>公共倍数</small>
                  <strong key={game!.multiplier}>×{game!.multiplier}</strong>
                  <Info size={13} />
                </button>
                {game!.wildRank && (
                  <span className="wild-indicator">
                    本局癞子 <b>{rankText(game!.wildRank)}</b>
                  </span>
                )}
              </div>
            )}
            {seatCard(leftSeat, "left")}
            {seatCard(rightSeat, "right")}
            {live ? (
              <>
                {[leftSeat, rightSeat, baseSeat].map((i) => (
                  <div key={i}>{tablePlay(i)}</div>
                ))}
                {game!.phase === "bidding" && (
                  <div className="stage-message">
                    <span className="round-label">叫抢阶段</span>
                    <h2>
                      {myTurn
                        ? game!.bidStage === "call"
                          ? "这一手，你来做地主？"
                          : "要争取地主吗？"
                        : `${room.seats[game!.turn]?.name} 正在${game!.bidStage === "call" ? "叫" : "抢"}地主`}
                    </h2>
                    <p>每次抢地主，公共倍数翻倍</p>
                  </div>
                )}
                {game!.phase === "doubling" && (
                  <div className="stage-message">
                    <span className="round-label">地主已确定</span>
                    <h2>这一局，加倍吗？</h2>
                    <p>选择完成后统一公开 · 只影响你与对手的结算</p>
                  </div>
                )}
                {room.pausedUntil && (
                  <div className="reconnect-banner">
                    <WifiOff size={18} />
                    等待玩家重新连接 · {countdown}s
                  </div>
                )}
              </>
            ) : (
              <div className="waiting-center">
                <span className="round-label">
                  {room.game ? "下一局，重新出发" : "好友已在路上"}
                </span>
                <h2>
                  {room.seats.filter(Boolean).length === 3
                    ? "三人已落座"
                    : "留个位置，等你来"}
                </h2>
                <p>
                  {room.kind === "pve"
                    ? "准备好，开始下一局练习。"
                    : "所有人准备后，牌局自动开始。"}
                </p>
                {room.kind === "pvp" && (
                  <button
                    className="invite-code"
                    onClick={() =>
                      void perform(async () => {
                        await navigator.clipboard.writeText(room.code);
                        setNotice("房间码已复制");
                      })
                    }
                  >
                    <small>房间码</small>
                    <b>{room.code}</b>
                    <Copy size={17} />
                  </button>
                )}
                {room.result && (
                  <button
                    className="text-button"
                    onClick={() => setModal("result")}
                  >
                    查看上局结果 <ArrowRight size={14} />
                  </button>
                )}
              </div>
            )}
            {!live && seatCard(baseSeat, "bottom")}
          </section>
          <section className="player-area">
            {live && (
              <div className="action-zone">
                {mySeat < 0 ? (
                  <div className="watching-self">
                    {seatCard(baseSeat, "bottom")}
                    <div className="watching-label">
                      <Eye size={16} />
                      观战中 · 结算后开放全牌回放
                    </div>
                  </div>
                ) : room.pausedUntil ? (
                  <p className="action-status">牌局已暂停，等待重连</p>
                ) : game!.phase === "bidding" ? (
                  myTurn ? (
                    <>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          void command({
                            type: "game",
                            action: { type: "bid", yes: false },
                          })
                        }
                      >
                        {game!.bidStage === "call" ? "不叫" : "不抢"}
                      </button>
                      <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() =>
                          void command({
                            type: "game",
                            action: { type: "bid", yes: true },
                          })
                        }
                      >
                        {game!.bidStage === "call" ? "叫地主" : "抢地主 ×2"}
                        <Crown size={17} />
                      </button>
                    </>
                  ) : (
                    <p className="action-status">等候叫抢 · {countdown}s</p>
                  )
                ) : game!.phase === "doubling" ? (
                  game!.doubles[mySeat] === null ? (
                    <>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          void command({
                            type: "game",
                            action: { type: "double", yes: false },
                          })
                        }
                      >
                        不加倍
                      </button>
                      <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() =>
                          void command({
                            type: "game",
                            action: { type: "double", yes: true },
                          })
                        }
                      >
                        加倍 ×2
                        <ArrowDownLeft size={17} />
                      </button>
                    </>
                  ) : (
                    <p className="action-status">
                      <Check size={16} />
                      已选择，等待其他玩家 · {countdown}s
                    </p>
                  )
                ) : (
                  <>
                    <button
                      className="secondary-button"
                      disabled={!myTurn || !game!.trick || busy}
                      onClick={() =>
                        void command({ type: "game", action: { type: "pass" } })
                      }
                    >
                      不出
                    </button>
                    <button
                      className="secondary-button hint-button"
                      disabled={!myTurn || busy}
                      onClick={() =>
                        void perform(async () => {
                          const result = await send("room.hint", {});
                          setNotice(result.explanation);
                          setSelected(
                            result.action.type === "play"
                              ? result.action.cardIds
                              : [],
                          );
                        })
                      }
                    >
                      <Lightbulb size={16} />
                      提示
                    </button>
                    <button
                      className="primary-button"
                      disabled={!myTurn || busy || !interpretations.length}
                      onClick={playSelected}
                    >
                      出牌
                      <ArrowRight size={17} />
                    </button>
                  </>
                )}
                {mySeat >= 0 &&
                  !room.pausedUntil &&
                  ((game!.phase === "doubling" &&
                    game!.doubles[mySeat] === null) ||
                    (myTurn && game!.phase !== "doubling")) && (
                    <span
                      className={`action-timer ${countdown <= 5 ? "urgent" : ""}`}
                      aria-label={`操作剩余 ${countdown} 秒`}
                    >
                      {countdown}s
                    </span>
                  )}
                {live && mySeat >= 0 && selected.length > 0 && (
                  <button
                    className="clear-selection"
                    onClick={() => setSelected([])}
                    aria-label="取消选牌"
                  >
                    <X size={14} />
                    <span>取消</span>
                  </button>
                )}
              </div>
            )}
            {live && mySeat >= 0 ? (
              <>
                <Hand
                  cards={hand}
                  selected={selected}
                  setSelected={setSelected}
                  wild={game!.wildRank}
                  bottomIds={
                    game!.landlord === mySeat
                      ? game!.bottom.map((c) => c.id)
                      : []
                  }
                />
                <div className="self-bar">
                  <div className="self-identity">
                    <span className="small-avatar self-avatar">
                      {Array.from(account?.name ?? "")[0]}
                    </span>
                    <span>
                      {account?.name}
                      <small>
                        {game!.landlord === mySeat
                          ? "地主"
                          : game!.landlord < 0
                            ? "等待身份"
                            : "农民"}{" "}
                        · {hand.length} 张
                      </small>
                    </span>
                  </div>
                  <div className="personal-rate">
                    {game!.landlord >= 0 && game!.phase !== "doubling" ? (
                      mySeat === game!.landlord ? (
                        <>
                          <span>
                            与{room.seats[(mySeat + 1) % 3]?.name}{" "}
                            <b>
                              ×{pairMultiplier((mySeat + 1) % 3).toString()}
                            </b>
                          </span>
                          <span>
                            与{room.seats[(mySeat + 2) % 3]?.name}{" "}
                            <b>
                              ×{pairMultiplier((mySeat + 2) % 3).toString()}
                            </b>
                          </span>
                        </>
                      ) : (
                        <span>
                          你与地主 <b>×{pairMultiplier(mySeat).toString()}</b>
                        </span>
                      )
                    ) : (
                      <span>底注 10 Tokens · 起始 ×15</span>
                    )}
                  </div>
                </div>
              </>
            ) : !live ? (
              <div className="waiting-actions">
                {mySeat >= 0 ? (
                  <>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        room.kind === "pve"
                          ? setModal("leave")
                          : void command({ type: "stand" })
                      }
                    >
                      {room.kind === "pve" ? "离开练习" : "站起观战"}
                    </button>
                    <button
                      className="primary-button"
                      disabled={busy || !connected}
                      onClick={() => void command({ type: "ready" })}
                    >
                      {room.seats[mySeat]?.ready ? "取消准备" : "准备好了"}
                      {room.seats[mySeat]?.ready ? (
                        <Check size={17} />
                      ) : (
                        <ArrowRight size={17} />
                      )}
                    </button>
                  </>
                ) : (
                  <p className="watching-label">
                    <Eye size={16} />
                    你正在观战，有空座时可点击坐下
                  </p>
                )}
              </div>
            ) : null}
          </section>
          <footer className="room-footer">
            <span className="room-profile">
              <span className={`status-dot ${connected ? "" : "offline"}`} />
              {nicknameButton()}
            </span>
            <button className="text-button" onClick={() => setModal("rules")}>
              玩法与倍率 <Info size={13} />
            </button>
          </footer>
        </main>
      )}

      {(error || notice) && (
        <div
          className={`toast ${error ? "error-toast" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error ? <Info size={17} /> : <Check size={17} />}
          <span>{error || notice}</span>
          <button
            onClick={() => {
              setError("");
              setNotice("");
            }}
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {!connected && room && (
        <div className="offline-banner">
          <WifiOff size={16} />
          网络中断，正在重连。60 秒内返回可继续。
        </div>
      )}

      {modal === "nickname" && (
        <Modal title="修改昵称" onClose={closeModal}>
          <form
            className="nickname-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && nickname.trim() && [...nickname.trim()].length <= 16)
                void saveNickname();
            }}
          >
            <label className="input-label">
              你的昵称
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                maxLength={32}
                autoFocus
                autoComplete="nickname"
                required
                aria-describedby="nickname-help"
              />
            </label>
            <p className="muted" id="nickname-help">
              1–16 个字符，保存后同房玩家和观众会看到你的新昵称。
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={closeModal}
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={
                  busy || !nickname.trim() || [...nickname.trim()].length > 16
                }
              >
                保存昵称
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "settings" && (
        <Modal title="牌桌设置" onClose={closeModal}>
          <div className="settings-content">
            <label className="input-label">
              你的昵称
              <input
                value={nickname}
                maxLength={32}
                onChange={(e) => setNickname(e.target.value)}
              />
            </label>
            <button
              className="primary-button"
              disabled={
                busy || !nickname.trim() || [...nickname.trim()].length > 16
              }
              onClick={() => void saveNickname()}
            >
              保存昵称
            </button>
            <div className="setting-row">
              <span>
                牌桌外观<small>独立于标准 / 癞子玩法</small>
              </span>
              <button className="secondary-button" onClick={toggleTheme}>
                {theme === "light" ? <Sun size={17} /> : <Moon size={17} />}{" "}
                {theme === "light" ? "浅色" : "深色"}
              </button>
            </div>
            <div className="setting-row">
              <span>
                跟随玩法默认主题<small>标准浅色，癞子深色</small>
              </span>
              <button
                className="text-button"
                onClick={() => {
                  try {
                    localStorage.removeItem("clear-theme");
                  } catch {}
                  setTheme((room?.mode ?? mode) === "wild" ? "dark" : "light");
                  setNotice("已恢复自动主题");
                }}
              >
                <RotateCcw size={15} />
                恢复
              </button>
            </div>
            <p className="settings-note">
              <ShieldCheck size={17} />
              游客身份保存在本浏览器中。清除浏览器数据后，将无法找回当前 Tokens
              与战绩。
            </p>
          </div>
        </Modal>
      )}
      {modal === "rules" && (
        <Modal title="玩法与倍率" onClose={closeModal} wide>
          <Rules />
        </Modal>
      )}
      {modal === "leave" && (
        <Modal title="离开这张牌桌？" onClose={closeModal}>
          <p className="modal-copy">
            {live && mySeat >= 0
              ? game!.landlord >= 0
                ? "正在对局中。离开将立即结束本局，按当前倍数判你的阵营负；最多扣除现有 Tokens。"
                : "尚未确定地主，离开将使本局作废，不扣除 Tokens。"
              : "离开后，可以通过房间码重新加入。"}
          </p>
          <div className="modal-actions">
            <button className="secondary-button" onClick={closeModal}>
              继续留在这里
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => {
                void command({ type: "leave" });
                closeModal();
              }}
            >
              <LogOut size={16} />
              离开
            </button>
          </div>
        </Modal>
      )}
      {modal === "spectators" && room && (
        <Modal
          title={`观战席 · ${room.spectators.length}`}
          onClose={closeModal}
        >
          <p className="muted">
            只展示公开牌和剩余张数，对局结束后开放全牌回放。
          </p>
          <div className="spectator-list">
            {room.spectators.length ? (
              room.spectators.map((p) => (
                <div key={p.id}>
                  <span className="small-avatar">{Array.from(p.name)[0]}</span>
                  {p.name}
                </div>
              ))
            ) : (
              <div className="empty-state">
                <Eye size={28} />
                <p>暂时没有人在观战</p>
              </div>
            )}
          </div>
        </Modal>
      )}
      {modal === "multiplier" && game && (
        <Modal title="本局倍率记录" onClose={closeModal}>
          <div className="multiplier-ledger">
            {game.multiplierEvents.map((e, i) => (
              <div key={i}>
                <span>{e.reason}</span>
                <small>{i ? "×" + e.factor : "起始"}</small>
                <b>×{e.value}</b>
              </div>
            ))}
          </div>
          <p className="muted">
            个人加倍独立计算：底注 10 × 公共倍数 × 地主加倍 ×
            对应农民加倍。倍率不封顶，输家最多支付现有余额。
          </p>
        </Modal>
      )}
      {modal === "history" && (
        <Modal title="最近对局" onClose={closeModal}>
          <div className="history-list">
            {history.length ? (
              history.map((h) => (
                <button
                  key={h.id}
                  className="history-row"
                  onClick={() => void showReplay(h.id)}
                >
                  <span className={`result-dot ${h.won ? "won" : ""}`}>
                    {h.won ? "胜" : "负"}
                  </span>
                  <span>
                    {h.mode === "wild" ? "癞子" : "标准"} ·{" "}
                    {h.kind === "pve" ? "练习" : "好友"}
                    <small>
                      {new Date(h.at).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </span>
                  <strong className={BigInt(h.delta) > 0n ? "positive" : ""}>
                    {BigInt(h.delta) > 0n ? "+" : ""}
                    {formatTokens(h.delta)}
                  </strong>
                  <ChevronRight size={17} />
                </button>
              ))
            ) : (
              <div className="empty-state">
                <History size={30} />
                <p>第一局，从现在开始。</p>
                <span>完成的对局会保存在这里，可逐手复盘。</span>
              </div>
            )}
          </div>
        </Modal>
      )}
      {modal === "result" && room?.result && (
        <Modal title="这一局，落定" onClose={closeModal}>
          <div className="result-head">
            <Crown size={35} />
            <h3>
              {room.result.winner === "landlord" ? "地主获胜" : "农民获胜"}
            </h3>
            <p>
              {room.result.reason} · 公共倍数 ×{room.result.multiplier}
            </p>
          </div>
          <div className="result-lines">
            {room.result.lines.map((p) => (
              <div key={p.id}>
                <span>
                  {p.name}
                  {p.id === account?.id && <small>你</small>}
                </span>
                <strong
                  title={`${p.delta} Tokens`}
                  className={BigInt(p.delta) > 0n ? "positive" : ""}
                >
                  {BigInt(p.delta) > 0n ? "+" : ""}
                  {formatTokens(p.delta)} <small>Tokens</small>
                </strong>
              </div>
            ))}
          </div>
          <p className="muted">
            实际收支以可支付余额为限；余额不足时按应得比例分配。
          </p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => void showReplay(room.result!.replayId)}
            >
              <History size={16} />
              逐手复盘
            </button>
            {account?.balance === "0" ? (
              <button
                className="primary-button"
                onClick={() => void openRelief()}
              >
                答题领救济
              </button>
            ) : (
              <button className="primary-button" onClick={closeModal}>
                回到牌桌
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </Modal>
      )}
      {modal === "relief" && relief && (
        <Modal title="再来一手" onClose={closeModal}>
          <p className="modal-copy">
            答对一道算术题，领取 10 KTokens。每次输光后都可以再来。
          </p>
          <div className="arithmetic">{relief.question}</div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                setAccount(
                  await api("/relief/claim", "POST", { id: relief.id, answer }),
                );
                closeModal();
                setNotice("已领取 10 KTokens，继续练习吧");
              });
            }}
          >
            <input
              className="answer-input"
              aria-label="算术题答案"
              inputMode="numeric"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
            <button
              className="primary-button full-width"
              disabled={busy || !answer}
            >
              领取 10 KTokens
            </button>
          </form>
        </Modal>
      )}
      {modal === "replay" && replay && (
        <Modal title="逐手复盘" onClose={closeModal} wide>
          <ReplayView replay={replay} step={step} setStep={setStep} />
        </Modal>
      )}
      {choices && (
        <Modal title="选择这手牌的解释" onClose={() => setChoices(null)}>
          <p className="muted">癞子可以组成不同牌型，请确认出法。</p>
          <div className="interpretations">
            {choices.map((p, i) => (
              <button
                className="interpretation"
                key={i}
                onClick={() => submitPlay(p)}
              >
                <span>
                  {playName(p)}
                  <small>
                    {p.cards
                      .map((c, i) =>
                        c.rank !== p.as[i]
                          ? `${rankText(c.rank)}→${rankText(p.as[i])}`
                          : "",
                      )
                      .filter(Boolean)
                      .join(" · ") || "按原点数使用"}
                  </small>
                </span>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Rules() {
  return (
    <div className="rules-content">
      <p className="rules-lead">
        三人一桌，地主对抗两名农民。任一农民出完牌，两名农民共同获胜。
      </p>
      <div className="rules-grid">
        <section>
          <h3>出牌</h3>
          <p>
            每人 17 张，地主取得 3
            张公开底牌，先出。按逆时针轮转；连续两人不出后重新领出，领出不能不出。
          </p>
          <p>
            支持单张、对子、三张、三带一／对、顺子、连对、飞机及带牌、四带二单／两对、炸弹与王炸。顺子至少五张，连对至少三对，飞机至少两组；连续主体不含
            2 和王。
          </p>
          <p>
            飞机单翼可带对子，不能同时带双王、整副四张炸弹或主体点数；四带二单可带一对但不能带双王。带对子须点数不同且不与主体相同。
          </p>
          <h3>叫抢与加倍</h3>
          <p>
            首次叫地主不翻倍，每次抢地主
            ×2。已“不叫”的玩家不能再抢；有人抢后，首叫者可最后再抢一次。都不叫则重发。
          </p>
          <p>
            亮底牌后三人同时选择 ×1 或
            ×2，完成后公开。个人加倍只影响与地主／对应农民的结算。不设明牌。
          </p>
        </section>
        <section>
          <h3>公共倍数，从 ×15 开始</h3>
          <div className="rule-table">
            {[
              ["抢地主", "×2"],
              ["底牌：单王、同花、三张顺子", "×2"],
              ["底牌：双王、三条、同花顺", "×4"],
              ["标准：炸弹、王炸", "×2"],
              ["癞子：软炸弹", "×2"],
              ["癞子：硬炸、纯癞子炸、王炸", "×4"],
              ["春天 / 反春天", "×2"],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>
          <p>
            底牌奖励仅取最高一项，按原牌判断，顺子范围 3 至
            A。四带二不算炸弹。地主胜且农民均未出牌为春天；农民胜且地主仅出一手为反春天。
          </p>
          <h3>四癞子玩法</h3>
          <p>
            定地主后随机选择一个非王点数为癞子，可替代 3 至
            2。全由癞子组成的一至三张按原点数，四张为纯癞子炸。王炸 ＞ 纯癞子炸
            ＞ 硬炸 ＞ 软炸；不设长炸弹。
          </p>
        </section>
      </div>
      <div className="rule-footnote">
        <b>Tokens 与离开</b>
        <p>
          底注 10 Tokens，初始 100
          KTokens。倍率无上限、余额不透支，实际扣款等于实际奖励；地主余额不足按理论应得比例分账。输光后答题领取
          10 KTokens，次数不限。主动离开判阵营负，断线保留 60
          秒；确定地主前退出作废，退出不触发春天。
        </p>
        <p>
          本项目采用明确约定的规则，参考传统欢乐斗地主；底牌等扩展不是腾讯所有版本的统一规则。
        </p>
      </div>
    </div>
  );
}

function ReplayView({
  replay,
  step,
  setStep,
}: {
  replay: Replay;
  step: number;
  setStep: (n: number) => void;
}) {
  const { game, players } = replay,
    events = game.events.slice(0, step + 1),
    last = events.at(-1);
  const hands = game.initialHands.map((h) => [...h]);
  if (events.some((e) => e.type === "landlord"))
    hands[game.landlord].push(...game.bottom);
  for (const e of events)
    if (e.play) {
      const ids = new Set(e.play.cards.map((c) => c.id));
      hands[e.seat] = hands[e.seat].filter((c) => !ids.has(c.id));
    }
  return (
    <div className="replay-content">
      <div className="replay-explanation">
        <small>
          {step < 0 ? "发牌完成" : `第 ${step + 1} 步 / ${game.events.length}`}
        </small>
        <h3>
          {last
            ? `${players[last.seat]?.name ?? "玩家"} · ${last.text}`
            : "从最初的手牌开始"}
        </h3>
        <p>
          {last?.explanation ??
            (last?.type === "play"
              ? "观察出牌后的手牌结构和其他玩家剩余张数。"
              : "拖动时间轴，查看每一步公开动作与手牌变化。")}
        </p>
      </div>
      <div className="replay-controls">
        <button
          className="icon-button"
          aria-label="上一步"
          disabled={step < 0}
          onClick={() => setStep(step - 1)}
        >
          <ArrowLeft size={18} />
        </button>
        <input
          type="range"
          aria-label="复盘进度"
          min={-1}
          max={game.events.length - 1}
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
        />
        <button
          className="icon-button"
          aria-label="下一步"
          disabled={step >= game.events.length - 1}
          onClick={() => setStep(step + 1)}
        >
          <ArrowRight size={18} />
        </button>
      </div>
      <div className="replay-hands">
        {hands.map((h, i) => (
          <div className="replay-player" key={i}>
            <div>
              <b>{players[i]?.name ?? "已离开的玩家"}</b>
              <span>
                {i === game.landlord ? "地主" : "农民"} · {h.length} 张
              </span>
            </div>
            <div className="replay-cards">
              {sortCards(h).map((c) => (
                <CardFace
                  key={c.id}
                  card={c}
                  small
                  wild={c.rank === game.wildRank}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="muted">
        全牌信息仅在对局结束后开放。AI 决策时只能读取自己的手牌和公开信息。
      </p>
    </div>
  );
}
