// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { StaffError } from '../../src/staff/lib/backend';
import { parseRoute } from '../../src/staff/router';
import { WebsiteScreen } from '../../src/staff/screens/WebsiteScreen';
import { fakeOps, siteContent, V1 } from './fake-ops';

// The Website screens (Phase 6b) against a scripted backend: what they send.
// Who may call the content functions is proven in the database tests.

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const show = (hash: string, ops = fakeOps()) => {
  render(<WebsiteScreen ops={ops} route={parseRoute(hash)} />);
  return ops;
};

describe('website lists', () => {
  it('contact details: shown filled in; blanks are saved as empty, with the current version', async () => {
    const ops = show('#/website');
    const phone = await screen.findByLabelText('Phone') as HTMLInputElement;
    expect(phone.value).toBe('+234 811 859 9365');
    await userEvent.type(screen.getByLabelText('Email'), 'hello@smm.example');
    await userEvent.clear(screen.getByLabelText('Address'));
    await userEvent.click(screen.getByRole('button', { name: 'Save contact details' }));
    await waitFor(() => expect(ops.saveContact).toHaveBeenCalledWith(V1, {
      address: null, phone: '+234 811 859 9365', phone_secondary: null, phone_third: null, email: 'hello@smm.example', whatsapp: '+234 811 859 9365',
    }));
    expect(await screen.findByText('Contact details saved.')).toBeTruthy();
    expect(ops.content).toHaveBeenCalledTimes(2); // reloaded after saving
  });

  it('a refused save says why in plain words', async () => {
    const ops = fakeOps();
    ops.saveContact.mockRejectedValueOnce(new StaffError('stale_record'));
    show('#/website', ops);
    await userEvent.click(await screen.findByRole('button', { name: 'Save contact details' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Someone else changed this/);
  });

  it('FAQs: listed in website order with their state; moving one sends the whole new order', async () => {
    const ops = show('#/website?tab=faqs');
    await screen.findByText('How long is a session?');
    const items = within(document.querySelector('ol')!).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('How long is a session?'), expect.stringContaining('What should I wear?'),
    ]);
    expect(within(items[0]).getByText('On the website')).toBeTruthy();
    expect(within(items[1]).getByText('Hidden')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Move up: How long is a session?' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Move down: How long is a session?' }));
    await waitFor(() => expect(ops.reorder).toHaveBeenCalledWith('faq', ['faq-2', 'faq-1']));
  });

  it('testimonials carry the real-guests-only note', async () => {
    show('#/website?tab=testimonials');
    expect(await screen.findByText(/Only show testimonials from real guests/)).toBeTruthy();
  });
});

describe('editors', () => {
  it('a new FAQ is saved with blank-line paragraphs, then opened; it starts hidden', async () => {
    const ops = show('#/website/faq/new');
    await userEvent.type(await screen.findByLabelText('Question'), 'Do you come to my home?');
    await userEvent.type(screen.getByLabelText('Answer'), 'Yes, across Lagos.{enter}{enter}A travel fee applies.');
    await userEvent.click(screen.getByRole('button', { name: 'Add FAQ' }));
    await waitFor(() => expect(ops.saveFaq).toHaveBeenCalledWith(null, null, {
      question: 'Do you come to my home?', answer: ['Yes, across Lagos.', 'A travel fee applies.'],
    }));
    expect(window.location.hash).toBe('#/website/faq/faq-new');
  });

  it('showing and hiding uses the item version; delete waits until it is hidden and needs a reason', async () => {
    const ops = show('#/website/faq/faq-1');
    const answer = await screen.findByLabelText('Answer') as HTMLTextAreaElement;
    expect(answer.value).toBe('Sixty minutes.');
    const deletePanel = screen.getByRole('region', { name: 'Delete this FAQ' });
    expect(within(deletePanel).queryByRole('button')).toBeNull();
    expect(within(deletePanel).getByText(/Take it off the website first/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Take off the website' }));
    await waitFor(() => expect(ops.setPublished).toHaveBeenCalledWith('faq', 'faq-1', false, V1));
  });

  it('deleting a hidden item records the reason and returns to the list', async () => {
    const ops = show('#/website/faq/faq-2');
    const panel = await screen.findByRole('region', { name: 'Delete this FAQ' });
    const button = within(panel).getByRole('button', { name: 'Delete permanently' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await userEvent.type(within(panel).getByLabelText('Reason'), 'Duplicate question');
    await userEvent.click(button);
    await waitFor(() => expect(ops.deleteContent).toHaveBeenCalledWith('faq', 'faq-2', 'Duplicate question', V1));
    expect(window.location.hash).toBe('#/website?tab=faqs');
  });

  it('gallery: a picture is chosen from the library, and the built-in one is dropped', async () => {
    const ops = show('#/website/gallery/g-1');
    await userEvent.click(await screen.findByRole('radio', { name: 'Hot stones on a back' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ops.saveGalleryItem).toHaveBeenCalledWith('g-1', V1, {
      title: 'Sanctuary room', category: 'sanctuary', imageMediaId: 'm-1', imageUrl: null,
    }));
  });

  it('gallery: a new item without a picture is not sent', async () => {
    const ops = show('#/website/gallery/new');
    await userEvent.type(await screen.findByLabelText('Caption'), 'New room');
    await userEvent.click(screen.getByRole('button', { name: 'Add picture' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Choose a picture/);
    expect(ops.saveGalleryItem).not.toHaveBeenCalled();
  });

  it('uploading: wrong file types are refused before sending; a good one is uploaded and chosen', async () => {
    const ops = fakeOps();
    const after = siteContent();
    after.media.unshift({ ...after.media[1], id: 'm-new', altText: 'New room photo', url: 'https://x.test/new.jpg' });
    ops.content.mockResolvedValueOnce(siteContent()).mockResolvedValue(after);
    show('#/website/gallery/new', ops);
    const input = await screen.findByLabelText('Picture file') as HTMLInputElement;
    await userEvent.upload(input, new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' }), { applyAccept: false });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Only JPEG, PNG, WebP or AVIF/);

    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'room.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, photo);
    await userEvent.type(screen.getByLabelText('Description for screen readers'), 'New room photo');
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(ops.uploadMedia).toHaveBeenCalledWith(photo, 'gallery', 'New room photo'));
    expect(await screen.findByText('Uploaded and chosen. Save to use it.')).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'New room photo' }) as HTMLInputElement).checked).toBe(true);
  });

  it('testimonial: stars and treatment are sent; the permission reminder is shown', async () => {
    const ops = show('#/website/testimonial/new');
    expect(await screen.findByText(/Use only a real guest's own words/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Guest's name as shown"), 'Tunde A.');
    await userEvent.type(screen.getByLabelText('Review'), 'Best massage I have had in Lagos.');
    await userEvent.selectOptions(screen.getByLabelText('Stars'), '4');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(6));
    await userEvent.selectOptions(screen.getByLabelText('Treatment (optional)'), 's-1');
    await userEvent.click(screen.getByRole('button', { name: 'Add testimonial' }));
    await waitFor(() => expect(ops.saveTestimonial).toHaveBeenCalledWith(null, null, {
      authorName: 'Tunde A.', authorLocation: '', body: 'Best massage I have had in Lagos.', rating: 4, serviceId: 's-1',
    }));
  });

  it('announcement: dates typed in Lagos time are sent as instants', async () => {
    const ops = show('#/website/announcement/new');
    await userEvent.type(await screen.findByLabelText('Title'), 'Closed on Christmas Day');
    await userEvent.type(screen.getByLabelText('Show until (optional)'), '2026-12-26T00:00');
    await userEvent.click(screen.getByRole('button', { name: 'Add announcement' }));
    await waitFor(() => expect(ops.saveAnnouncement).toHaveBeenCalledWith(null, null, {
      kind: 'announcement', title: 'Closed on Christmas Day', body: '', startsAt: null, endsAt: '2026-12-26T00:00:00+01:00',
    }));
  });

  it('picture library: a picture in use cannot be removed; an unused one needs a reason', async () => {
    show('#/website/picture/m-1');
    expect(await screen.findByText(/used 1 time on the website/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove picture' })).toBeNull();
    cleanup();

    const ops = show('#/website/picture/m-2');
    const button = await screen.findByRole('button', { name: 'Remove picture' });
    await userEvent.type(screen.getByLabelText('Reason'), 'Blurry photo');
    await userEvent.click(button);
    await waitFor(() => expect(ops.removeMedia).toHaveBeenCalledWith('m-2', 'Blurry photo', V1));
    expect(window.location.hash).toBe('#/website?tab=pictures');
  });

  it('an item that no longer exists says so', async () => {
    show('#/website/faq/gone');
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeTruthy();
  });
});
