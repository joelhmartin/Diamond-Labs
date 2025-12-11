'use client';
import React, { useEffect, useMemo } from 'react';
import Link from 'next/link';
import useBlog from '~/hooks/useBlog';

const WidgetBlogRecentPosts = () => {
    const { loading, getPosts, posts } = useBlog();

    useEffect(() => {
        getPosts();
    }, []);

    // Views
    const articles = useMemo(() => {
        if (loading) return <p>Loading...</p>;
        return posts.length === 0 ? (
            <p>No posts found</p>
        ) : (
            posts.map((item) => {
                return (
                    <Link
                        href={'/post/[pid]'}
                        as={`/post/${item.id}`}
                        key={item.id}>
                        {item.name}
                    </Link>
                );
            })
        );
    }, [loading, posts]);

    return (
        <aside className="widget widget--blog widget--recent-post">
            <h3 className="widget__title">Recent Posts</h3>
            <div className="widget__content">{articles}</div>
        </aside>
    );
};

export default WidgetBlogRecentPosts;
