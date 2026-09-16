import { motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/* Shared motion language (mirrored per app): calm, fast, springy.
   Wrap every screen in <Page>, stagger lists with <Stagger>/<Item>,
   and use <Press> for tappable cards. Respects the OS reduced-motion
   setting via <MotionConfig reducedMotion="user"> in App. */

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: EASE } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.18, ease: "easeIn" } },
};

export const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.06 } },
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.36, ease: EASE } },
};

export const popVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 10 },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring", stiffness: 380, damping: 30 },
  },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.16 } },
};

/** Screen-level entrance/exit wrapper. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <motion.div variants={pageVariants} initial="hidden" animate="show" exit="exit">
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
    <motion.div className={className} variants={itemVariants}>
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
