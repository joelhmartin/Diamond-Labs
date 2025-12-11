import React from 'react';
import Link from 'next/link';

const WidgetBlogRecentComments = () => {
    return (
        <aside className="widget widget--blog widget--recent-comments">
            <h3 className="widget__title">Recent Comments</h3>
            <div className="widget__content">
                <p>
                    <Link href={'/blog'} className="author">
                        Martfury
                    </Link>
                    on <Link href={'/blog'}>Dashboard</Link>
                </p>
                <p>
                    <Link href={'/blog'} className="author">
                        logan
                    </Link>
                    on{' '}
                    <Link href={'/blog'}>
                        Rayban Rounded Sunglass Brown Color
                    </Link>
                </p>
                <p>
                    <Link href={'/blog'} className="author">
                        logan
                    </Link>
                    on{' '}
                    <Link href={'/blog'}>
                        Sound Intone I65 Earphone White Version
                    </Link>
                </p>
                <p>
                    <Link href={'/blog'} className="author">
                        logan
                    </Link>
                    on
                    <Link href={'/blog'}>
                        Sleeve Linen Blend Caro Pane Shirt
                    </Link>
                </p>
            </div>
        </aside>
    );
};

export default WidgetBlogRecentComments;
