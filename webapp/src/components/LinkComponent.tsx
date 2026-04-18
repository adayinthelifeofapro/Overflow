'use client';

import Link, {LinkProps} from "next/link";
import {forwardRef} from "react";

export const LinkComponent = forwardRef<HTMLAnchorElement, LinkProps>(function 
LinkComponent(props, ref) {
    return <Link ref={ref} {...props} />;
});
