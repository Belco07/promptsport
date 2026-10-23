import type { ComponentType } from "react";
import {
  ArrowLeft as PhArrowLeft,
  ArrowRight as PhArrowRight,
  ArrowsLeftRight as PhArrowsLeftRight,
  ArrowUpRight as PhArrowUpRight,
  BellRinging as PhBellRinging,
  BookmarkSimple as PhBookmarkSimple,
  Broadcast as PhBroadcast,
  CalendarDots as PhCalendarDots,
  CaretDown as PhCaretDown,
  CaretLeft as PhCaretLeft,
  CaretRight as PhCaretRight,
  CaretUp as PhCaretUp,
  Chat as PhChat,
  ChatCircle as PhChatCircle,
  ChatTeardropText as PhChatTeardropText,
  Check as PhCheck,
  CheckCircle as PhCheckCircle,
  Checks as PhChecks,
  CircleNotch as PhCircleNotch,
  ClipboardText as PhClipboardText,
  Clock as PhClock,
  CreditCard as PhCreditCard,
  EnvelopeSimple as PhEnvelopeSimple,
  EnvelopeSimpleOpen as PhEnvelopeSimpleOpen,
  Eye as PhEye,
  EyeSlash as PhEyeSlash,
  FileText as PhFileText,
  Fire as PhFire,
  Flag as PhFlag,
  Heart as PhHeart,
  Heartbeat as PhHeartbeat,
  House as PhHouse,
  ImageSquare as PhImageSquare,
  Lock as PhLock,
  MagnifyingGlass as PhMagnifyingGlass,
  Medal as PhMedal,
  Microphone as PhMicrophone,
  Moon as PhMoon,
  Newspaper as PhNewspaper,
  Pause as PhPause,
  PenNib as PhPenNib,
  Play as PhPlay,
  Pulse as PhPulse,
  Quotes as PhQuotes,
  Record as PhRecord,
  Repeat as PhRepeat,
  Rss as PhRss,
  Scales as PhScales,
  ShareNetwork as PhShareNetwork,
  ShieldCheck as PhShieldCheck,
  ShieldSlash as PhShieldSlash,
  SlidersHorizontal as PhSlidersHorizontal,
  Smiley as PhSmiley,
  Sparkle as PhSparkle,
  Star as PhStar,
  Sun as PhSun,
  Tag as PhTag,
  TrendUp as PhTrendUp,
  Trophy as PhTrophy,
  User as PhUser,
  UserCheck as PhUserCheck,
  UserCircle as PhUserCircle,
  UserMinus as PhUserMinus,
  Users as PhUsers,
  Warning as PhWarning,
  X as PhX,
  XCircle as PhXCircle,
} from "@phosphor-icons/react/ssr";
import type { Icon as PhosphorIcon, IconProps as PhosphorIconProps } from "@phosphor-icons/react";

/**
 * Icônes du site public : jeu Phosphor (licence MIT), trait fin à bouts
 * arrondis, choisi pour se rapprocher de l'habillage « Digital Haven ».
 *
 * Les composants gardent les noms d'icônes de Lucide : seul leur import change
 * (`@/components/icons` au lieu de `lucide-react`). Les propriétés propres à
 * Lucide restent acceptées : `strokeWidth` et `absoluteStrokeWidth` sont
 * ignorées (Phosphor gère l'épaisseur par `weight`), et un `fill` autre que
 * « none » donne la variante pleine. La taille par défaut reste 24 px, comme
 * Lucide, pour ne rien décaler.
 *
 * L'export `/ssr` n'utilise pas de contexte React : ces icônes fonctionnent
 * aussi bien dans les composants serveur que client.
 */

export type IconProps = Omit<PhosphorIconProps, "weight"> & {
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
  fill?: string;
};

export type LucideIcon = ComponentType<IconProps>;

function wrap(PhIcon: PhosphorIcon, name: string): LucideIcon {
  function SiteIcon({ size = 24, strokeWidth, absoluteStrokeWidth, fill, ...rest }: IconProps) {
    void strokeWidth;
    void absoluteStrokeWidth;
    return <PhIcon size={size} weight={fill && fill !== "none" ? "fill" : "regular"} {...rest} />;
  }
  SiteIcon.displayName = name;
  return SiteIcon;
}

export const Activity = wrap(PhPulse, "Activity");
export const ArrowLeft = wrap(PhArrowLeft, "ArrowLeft");
export const ArrowLeftRight = wrap(PhArrowsLeftRight, "ArrowLeftRight");
export const ArrowRight = wrap(PhArrowRight, "ArrowRight");
export const ArrowRightLeft = wrap(PhArrowsLeftRight, "ArrowRightLeft");
export const ArrowUpRight = wrap(PhArrowUpRight, "ArrowUpRight");
export const Award = wrap(PhMedal, "Award");
export const BellRing = wrap(PhBellRinging, "BellRing");
export const Bookmark = wrap(PhBookmarkSimple, "Bookmark");
export const CalendarDays = wrap(PhCalendarDots, "CalendarDays");
export const Check = wrap(PhCheck, "Check");
export const CheckCheck = wrap(PhChecks, "CheckCheck");
export const CheckCircle2 = wrap(PhCheckCircle, "CheckCircle2");
export const ChevronDown = wrap(PhCaretDown, "ChevronDown");
export const ChevronLeft = wrap(PhCaretLeft, "ChevronLeft");
export const ChevronRight = wrap(PhCaretRight, "ChevronRight");
export const ChevronUp = wrap(PhCaretUp, "ChevronUp");
export const CircleDot = wrap(PhRecord, "CircleDot");
export const CircleX = wrap(PhXCircle, "CircleX");
export const ClipboardList = wrap(PhClipboardText, "ClipboardList");
export const Clock = wrap(PhClock, "Clock");
export const CreditCard = wrap(PhCreditCard, "CreditCard");
export const FileText = wrap(PhFileText, "FileText");
export const Eye = wrap(PhEye, "Eye");
export const EyeOff = wrap(PhEyeSlash, "EyeOff");
export const Flag = wrap(PhFlag, "Flag");
export const Flame = wrap(PhFire, "Flame");
export const Heart = wrap(PhHeart, "Heart");
export const HeartPulse = wrap(PhHeartbeat, "HeartPulse");
export const Home = wrap(PhHouse, "Home");
export const ImagePlus = wrap(PhImageSquare, "ImagePlus");
export const LoaderCircle = wrap(PhCircleNotch, "LoaderCircle");
export const Lock = wrap(PhLock, "Lock");
export const MailPlus = wrap(PhEnvelopeSimple, "MailPlus");
export const MailX = wrap(PhEnvelopeSimpleOpen, "MailX");
export const MessageCircle = wrap(PhChatCircle, "MessageCircle");
export const MessageSquare = wrap(PhChat, "MessageSquare");
export const MessageSquareQuote = wrap(PhChatTeardropText, "MessageSquareQuote");
export const Mic = wrap(PhMicrophone, "Mic");
export const Moon = wrap(PhMoon, "Moon");
export const Newspaper = wrap(PhNewspaper, "Newspaper");
export const Pause = wrap(PhPause, "Pause");
export const Pen = wrap(PhPenNib, "Pen");
export const Play = wrap(PhPlay, "Play");
export const Quote = wrap(PhQuotes, "Quote");
export const Radio = wrap(PhBroadcast, "Radio");
export const Repeat = wrap(PhRepeat, "Repeat");
export const Rss = wrap(PhRss, "Rss");
export const Scale = wrap(PhScales, "Scale");
export const Search = wrap(PhMagnifyingGlass, "Search");
export const Share2 = wrap(PhShareNetwork, "Share2");
export const ShieldCheck = wrap(PhShieldCheck, "ShieldCheck");
export const ShieldOff = wrap(PhShieldSlash, "ShieldOff");
export const SlidersHorizontal = wrap(PhSlidersHorizontal, "SlidersHorizontal");
export const Smile = wrap(PhSmiley, "Smile");
export const Sparkles = wrap(PhSparkle, "Sparkles");
export const Star = wrap(PhStar, "Star");
export const Sun = wrap(PhSun, "Sun");
export const Tag = wrap(PhTag, "Tag");
export const TrendingUp = wrap(PhTrendUp, "TrendingUp");
export const TriangleAlert = wrap(PhWarning, "TriangleAlert");
export const Trophy = wrap(PhTrophy, "Trophy");
export const User = wrap(PhUser, "User");
export const UserCheck = wrap(PhUserCheck, "UserCheck");
export const UserRound = wrap(PhUserCircle, "UserRound");
export const UserX = wrap(PhUserMinus, "UserX");
export const Users = wrap(PhUsers, "Users");
export const X = wrap(PhX, "X");
export const XCircle = wrap(PhXCircle, "XCircle");
