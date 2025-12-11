import React, { useMemo } from 'react';
import Link from 'next/link';
import moment from 'moment';
import Image from 'next/image';
import { getStrapiImageURL } from '~/services/strapiServices/image/getStrapiImageService';

const PostSmallThumbnail = ({ post }) => {
    const thumbnailImage = post.attributes?.thumbnail ? (
        <Image
            src={getStrapiImageURL(post.attributes.thumbnail)}
            alt=""
            layout="responsive"
            width={200}
            height={200}
        />
    ) : (
        <img src="https://placehold.co/600x400" alt="" />
    );

    return (
        <article className="ps-post ps-post--small-thumbnail">
            <div className="ps-post__thumbnail">
                <Link
                    href={'/post/[pid]'}
                    as={`/post/${post.id}`}
                    className="ps-post__overlay"
                />
                {thumbnailImage}
            </div>
            <div className="ps-post__content">
                <div className="ps-post__top">
                    <div className="ps-post__meta">Others</div>
                    <Link
                        href={'/post/[pid]'}
                        as={`/post/${post.id}`}
                        className="ps-post__title">
                        {post.attributes.name}
                    </Link>
                    <p>
                        Lorem ipsum dolor sit amet, dolor siterim consectetur
                        adipiscing elit. Phasellus duio faucibus est sed…
                    </p>
                </div>
                <p>
                    {moment(post.created_at).format('ll')} by
                    <Link href={'/blog'}>Martfury</Link>
                </p>
            </div>
        </article>
    );
};

export default PostSmallThumbnail;
