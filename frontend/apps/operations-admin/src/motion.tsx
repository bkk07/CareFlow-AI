import { motion, type Transition, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/* Shared motion language (mirrored per app): fast first paint, springy
   feedback, sliding active indicators via layoutId.
   Wrap every screen in <Page>, stagger lists with <Stagger>/<Item>,
   reveal below-the-fold sections with <Reveal>, and mark the active
   nav/sidebar entry with <ActivePill id>. Respects the OS reduced-motion
   setting via <MotionConfig reducedMotion="user"> in App. */

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const SPRING_SNAPPY: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 34,
};

export const SPRING_SOFT: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 28,
};

export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15, ease: "easeIn" } },
};

export const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

export const popVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 10 },
  show: { opacity: 1, scale: 1, y: 0, transition: SPRING_SNAPPY },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.14 } },
};

export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

/** Screen-level entrance/exit wrapper. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show" exit="exit">
      {children}
    </motion.div>
  );
}

/** Opacity-only wrapper for content that must paint instantly. */
export function Fade({ children }: { children: ReactNode }) {
  return (
    <motion.div variants={fadeVariants} initial="hidden" animate="show" exit="exit">
      {children}
    </motion.div>
  );
}

/** Scroll-triggered reveal for below-the-fold sections. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Staggered container — children must be <Item> (or motion children). */
export function Stagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={listVariants}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

/** Staggered child. */
export function Item({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={itemVariants} layout>
      {children}
    </motion.div>
  );
}

/** Tappable card: gentle lift on hover, press-down on tap. */
export function Press({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <motion.div
      className={className}
      variants={itemVariants}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}

/** Sliding active indicator — one shared `id` per nav group makes the
    highlight glide between entries instead of blinking. */
export function ActivePill({ id, className }: { id: string; className: string }) {
  return (
    <motion.span
      layoutId={id}
      className={className}
      transition={SPRING_SNAPPY}
    />
  );
}
