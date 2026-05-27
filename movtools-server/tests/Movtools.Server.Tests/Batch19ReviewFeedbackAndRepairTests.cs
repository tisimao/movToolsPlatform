using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Movtools.Server.Api.Contracts;
using Movtools.Server.Infrastructure.Persistence;
using Movtools.Server.Infrastructure.Services;
using ByteArrayContent = System.Net.Http.ByteArrayContent;

namespace Movtools.Server.Tests;

[Collection("postgres integration")]
public sealed class Batch19ReviewFeedbackAndRepairTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly PostgresFixture _fixture;

    public Batch19ReviewFeedbackAndRepairTests(PostgresFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task Create_feedback_with_version_and_annotation_succeeds()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-VER-TEST");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);

        var feedback = await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", 42, "01:23.456",
                "Fix this edge case", ["构图"], "CHANGE_REQUEST",
                "/uploads/test/frame.png", "/uploads/test/annotated.png",
                "/uploads/test/thumb.png", "{\"shapes\":[{\"type\":\"arrow\"}]}"),
            JsonOptions).ReadAsJsonAsync<ReviewCommentResponse>(JsonOptions);

        Assert.NotNull(feedback);
        Assert.Equal("Fix this edge case", feedback!.Content);
        Assert.Equal(42, feedback.FrameNumber);
        Assert.Equal("01:23.456", feedback.Timecode);
        using (var doc = JsonDocument.Parse(feedback.AnnotationDataJson!))
        {
            Assert.Equal("{\"shapes\":[{\"type\":\"arrow\"}]}", doc.RootElement.GetProperty("annotationDataJson").GetString());
        }
        Assert.Equal("/uploads/test/frame.png", feedback.FrameImagePath);
        Assert.Equal("/uploads/test/annotated.png", feedback.AnnotatedImagePath);
        Assert.Equal("/uploads/test/thumb.png", feedback.ThumbnailPath);
    }

    [Fact]
    public async Task Create_feedback_accepts_single_frame_drawings_and_clear_anchor()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-DRAW-ROUND");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);

        var feedback = await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", 42, "01:23.456",
                "Drawn and cleared", ["构图"], "CHANGE_REQUEST",
                "/uploads/test/frame.png", "/uploads/test/annotated.png",
                "/uploads/test/thumb.png", null,
                null, null,
                [
                    new ReviewDrawingFrameUpsertRequest(1, 12.5, "00:00:12.500", "DRAWN", "{\"paths\":[{\"x\":1}]}") ,
                    new ReviewDrawingFrameUpsertRequest(2, 13.5, "00:00:13.500", "CLEAR", null)
                ]),
            JsonOptions).ReadAsJsonAsync<ReviewCommentResponse>(JsonOptions);

        Assert.NotNull(feedback);
        Assert.NotNull(feedback!.DrawingFrames);
        Assert.Equal(2, feedback.DrawingFrames!.Count);
        Assert.Equal("DRAWN", feedback.DrawingFrames[0].DrawingStateCode);
        Assert.Equal("CLEAR", feedback.DrawingFrames[1].DrawingStateCode);

        Assert.NotEqual(Guid.Empty, feedback.FeedbackRoundId);

        var round = await adminClient.GetFromJsonAsync<ReviewFeedbackLensResponse>(
            $"/api/reviews/lens/{lens!.Id}/feedbacks?feedbackRoundId={feedback.FeedbackRoundId}", JsonOptions);

        Assert.NotNull(round);
        Assert.Equal(feedback.FeedbackRoundId, round!.LatestFeedbackRoundId);
        Assert.Single(round.Feedbacks);
        Assert.Equal(2, round.DrawingFrames.Count);
        Assert.Contains(round.DrawingFrames, f => f.DrawingStateCode == "CLEAR" && f.DrawingObjectsJson is null);
    }

    [Fact]
    public async Task Create_feedback_allows_drawing_only_submission()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-DRAW-NO-TEXT");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);

        var response = await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", null, null,
                null, null, "CHANGE_REQUEST", null, null, null, null,
                null, null,
                [new ReviewDrawingFrameUpsertRequest(1, 12.5, "00:00:12.500", "DRAWN", "{\"paths\":[]}")]),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var feedback = await response.Content.ReadFromJsonAsync<ReviewCommentResponse>(JsonOptions);
        Assert.NotNull(feedback);
        Assert.NotNull(feedback!.DrawingFrames);
        Assert.Single(feedback.DrawingFrames!);
        Assert.Equal("DRAWN", feedback.DrawingFrames![0].DrawingStateCode);
        Assert.NotNull(feedback.FeedbackRoundId);
    }

    [Fact]
    public async Task Update_feedback_allows_drawing_only_changes_and_keeps_round_data()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-UPD-DRAW");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);

        var created = await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", 42, "01:23.456",
                "Original text", null, "CHANGE_REQUEST", null, null, null, null,
                null, null,
                [new ReviewDrawingFrameUpsertRequest(1, 12.5, "00:00:12.500", "DRAWN", "{\"paths\":[{\"x\":1}]}")]),
            JsonOptions).ReadAsJsonAsync<ReviewCommentResponse>(JsonOptions);

        Assert.NotNull(created);

        var updatedResponse = await adminClient.PutAsJsonAsync(
            $"/api/review-feedbacks/{created!.Id}",
            new ReviewFeedbackUpdateRequest(
                null,
                null,
                "APPROVED",
                null,
                null,
                "{\"drawingFrames\":[{\"frameNumber\":2,\"timestampSeconds\":13.5,\"timecode\":\"00:00:13.500\",\"drawingStateCode\":\"CLEAR\",\"drawingObjectsJson\":null}]}",
                null),
            JsonOptions).ReadAsJsonAsync<ReviewCommentResponse>(JsonOptions);

        Assert.NotNull(updatedResponse);
        Assert.Equal("Original text", updatedResponse!.Content);
        Assert.Equal("APPROVED", updatedResponse.DecisionCode);
        Assert.NotNull(updatedResponse.FeedbackRoundId);
        Assert.NotNull(updatedResponse.DrawingFrames);
        Assert.Single(updatedResponse.DrawingFrames!);
        Assert.Equal(2, updatedResponse.DrawingFrames![0].FrameNumber);
        Assert.Equal("CLEAR", updatedResponse.DrawingFrames![0].DrawingStateCode);
        Assert.Null(updatedResponse.DrawingFrames![0].DrawingObjectsJson);
    }

    [Fact]
    public async Task Create_feedback_rejects_invalid_drawing_state_code()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-DRAW-STATE");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);

        var response = await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", null, null,
                "With drawing", null, "CHANGE_REQUEST", null, null, null, null,
                null, null,
                [new ReviewDrawingFrameUpsertRequest(1, 12.5, "00:00:12.500", "paint", "{\"paths\":[]}")]),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Create_feedback_rejects_clear_frame_with_objects()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-DRAW-CLEAR");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);

        var response = await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", null, null,
                "Clear frame", null, "CHANGE_REQUEST", null, null, null, null,
                null, null,
                [new ReviewDrawingFrameUpsertRequest(1, 12.5, "00:00:12.500", "CLEAR", "{\"paths\":[]}")]),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Create_feedback_does_not_change_task_status()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-NOCHG");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);

        var taskBefore = await adminClient.GetFromJsonAsync<JsonElement>(
            $"/api/review-tasks/{taskId}", JsonOptions);

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", null, null,
                "Needs work", null, "CHANGE_REQUEST", null, null, null, null),
            JsonOptions);

        var taskAfter = await adminClient.GetFromJsonAsync<JsonElement>(
            $"/api/review-tasks/{taskId}", JsonOptions);

        var statusBefore = taskBefore.GetProperty("status").GetString();
        var statusAfter = taskAfter.GetProperty("status").GetString();
        Assert.Equal(statusBefore, statusAfter);
        Assert.NotEqual("completed", statusAfter);
        Assert.NotEqual("closed", statusAfter);
    }

    [Fact]
    public async Task Create_feedback_sets_lens_to_PENDING_FEEDBACK_FIX()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-PEND");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", null, null,
                "Fix this", null, "CHANGE_REQUEST", null, null, null, null),
            JsonOptions);

        var lensAfter = await adminClient.GetFromJsonAsync<LensResponse>(
            $"/api/lenses/{lens.Id}", JsonOptions);

        Assert.NotNull(lensAfter);
        Assert.Equal("PENDING_FEEDBACK_FIX", lensAfter!.InternalReviewStatusCode);
    }

    [Fact]
    public async Task Mixed_review_and_context_shots_only_promote_review_shot()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lensA, project) = await CreateProjectEpisodeLensAsync(adminClient, "MIXED-REVIEW");
        var lensB = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{lensA!.EpisodeId}/lenses",
            new LensCreateRequest("L002", "Lens 2", 2, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        lensA = await TransitionToStatusAsync(adminClient, lensA!, "READY_FOR_REVIEW");

        var taskResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/tasks",
            new ReviewTaskCreateRequest(
                project!.Code,
                lensA.EpisodeId,
                "Mixed participation task",
                null,
                null,
                null,
                [
                    new ReviewTaskShotCreateRequest(lensA.Id, 1, lensA.VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(lensB!.Id, 2, lensB.VersionNum, "context")
                ]),
            JsonOptions).ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);

        Assert.NotNull(taskResponse);
        Assert.Equal(2, taskResponse!.Shots.Count);
        Assert.Equal("review", taskResponse.Shots[0].ParticipationMode);
        Assert.Equal("review", taskResponse.Shots[0].ReviewParticipationMode);
        Assert.Equal("context", taskResponse.Shots[1].ParticipationMode);
        Assert.Equal(1, taskResponse.Summary!.ShotCount);

        var submitted = await adminClient.PostAsJsonAsync(
            $"/api/review-tasks/tasks/{taskResponse.Id}/submit",
            new { },
            JsonOptions).ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);

        Assert.NotNull(submitted);
        var lensAAfter = await adminClient.GetFromJsonAsync<LensResponse>($"/api/lenses/{lensA.Id}", JsonOptions);
        Assert.NotNull(lensAAfter);

        var lensBAfter = await adminClient.GetFromJsonAsync<LensResponse>($"/api/lenses/{lensB.Id}", JsonOptions);
        Assert.NotNull(lensBAfter);

        var detail = await adminClient.GetFromJsonAsync<ReviewTaskResponse>($"/api/review-tasks/{taskResponse.Id}", JsonOptions);
        Assert.NotNull(detail);

        var contextShot = detail!.Shots.First(x => x.ParticipationMode == "context");
        Assert.Equal("context", contextShot.ParticipationMode);
        var feedbackResponse = await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskResponse.Id,
                lensB.Id,
                lensB.VersionNum,
                null,
                null,
                "Context shot should not accept feedback",
                null,
                "CHANGE_REQUEST",
                null,
                null,
                null,
                null,
                contextShot.LatestFeedbackId),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Conflict, feedbackResponse.StatusCode);
    }

    [Fact]
    public async Task Producer_close_preserves_feedback_facts_and_shot_counts()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lensA, project) = await CreateProjectEpisodeLensAsync(adminClient, "CLOSE-CLEAR");
        var lensB = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{lensA!.EpisodeId}/lenses",
            new LensCreateRequest("L002", "Lens 2", 2, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        var taskResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/tasks",
            new ReviewTaskCreateRequest(
                project!.Code,
                lensA.EpisodeId,
                "Close and clear",
                null,
                null,
                null,
                [
                    new ReviewTaskShotCreateRequest(lensA.Id, 1, lensA.VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(lensB!.Id, 2, lensB.VersionNum, "context")
                ]),
            JsonOptions).ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);

        Assert.NotNull(taskResponse);

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskResponse!.Id,
                lensA.Id,
                lensA.VersionNum,
                null,
                null,
                "Need another pass",
                null,
                "CHANGE_REQUEST",
                null,
                null,
                null,
                null,
                taskResponse.Shots.First(x => x.LensId == lensA.Id).Id),
            JsonOptions);

        var taskBeforeClose = await adminClient.GetFromJsonAsync<ReviewTaskResponse>($"/api/review-tasks/{taskResponse.Id}", JsonOptions);
        Assert.NotNull(taskBeforeClose);

        var completedResponse = await adminClient.PostAsJsonAsync(
            $"/api/review-tasks/{taskResponse.Id}/approve",
            new ReviewActionRequest("approve", null, taskBeforeClose!.RowVersion),
            JsonOptions);
        Assert.Equal(HttpStatusCode.OK, completedResponse.StatusCode);

        var closeResponse = await adminClient.PostAsJsonAsync(
            $"/api/review-tasks/tasks/{taskResponse.Id}/close",
            new { },
            JsonOptions);

        Assert.Equal(HttpStatusCode.OK, closeResponse.StatusCode);

        var feedbacks = await adminClient.GetFromJsonAsync<ReviewFeedbackLensResponse>($"/api/review-feedbacks/lens/{lensA.Id}", JsonOptions);
        Assert.NotNull(feedbacks);
        Assert.NotEmpty(feedbacks!.Feedbacks);
        Assert.NotNull(feedbacks.DrawingFrames);

        var closedDetail = await adminClient.GetFromJsonAsync<ReviewTaskResponse>($"/api/review-tasks/{taskResponse.Id}", JsonOptions);
        Assert.NotNull(closedDetail);
        Assert.Equal(1, closedDetail!.CommentCount);
        Assert.Contains(closedDetail.Shots, shot => shot.FeedbackCount > 0 && shot.LatestFeedbackId.HasValue);

        var lensAfter = await adminClient.GetFromJsonAsync<LensResponse>($"/api/lenses/{lensA.Id}", JsonOptions);
        Assert.NotNull(lensAfter);
        Assert.NotEqual("READY_FOR_REVIEW", lensAfter!.InternalReviewStatusCode);
        Assert.NotEqual(0, lensAfter.PendingDirectorFeedbackCount);
    }

    [Fact]
    public async Task Recreated_task_does_not_reuse_closed_feedback()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "RECREATE-CLEAR");

        var firstTask = await CreateTaskWithShotsAsync(adminClient, project!, lens!, "review");
        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                firstTask.Id,
                lens!.Id,
                lens.VersionNum,
                null,
                null,
                "First round feedback",
                null,
                "CHANGE_REQUEST",
                null,
                null,
                null,
                null,
                firstTask.Shots[0].Id),
            JsonOptions);

        await adminClient.PostAsJsonAsync($"/api/review-tasks/tasks/{firstTask.Id}/close", new { }, JsonOptions);

        var secondTask = await CreateTaskWithShotsAsync(adminClient, project!, lens!, "review");

        var lensFeedbacks = await adminClient.GetFromJsonAsync<ReviewFeedbackLensResponse>($"/api/review-feedbacks/lens/{lens.Id}", JsonOptions);
        Assert.NotNull(lensFeedbacks);
        Assert.NotEmpty(lensFeedbacks!.Feedbacks);
        Assert.Empty(lensFeedbacks.DrawingFrames);

        var secondDetail = await adminClient.GetFromJsonAsync<ReviewTaskResponse>($"/api/review-tasks/{secondTask.Id}", JsonOptions);
        Assert.NotNull(secondDetail);
        Assert.Equal(0, secondDetail!.CommentCount);
        Assert.Equal("review", secondDetail.Shots[0].ParticipationMode);
    }

    [Fact]
    public async Task Task_shot_requires_explicit_participation_mode()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "DEFAULT-MODE");

        var response = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/tasks",
            new
            {
                projectCode = project!.Code,
                episodeId = lens!.EpisodeId,
                name = "Default review mode",
                description = (string?)null,
                directorUserId = (Guid?)null,
                dueAtUtc = (DateTimeOffset?)null,
                shots = new[]
                {
                    new
                    {
                        lensId = lens.Id,
                        sequence = 1,
                        submitVersionNum = lens.VersionNum
                    }
                }
            },
            JsonOptions);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Context_shots_are_excluded_from_completion_and_feedback_statistics()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lensA, project) = await CreateProjectEpisodeLensAsync(adminClient, "CONTEXT-STATS");
        var lensB = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{lensA!.EpisodeId}/lenses",
            new LensCreateRequest("L002", "Lens 2", 2, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        var taskResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/tasks",
            new ReviewTaskCreateRequest(
                project!.Code,
                lensA.EpisodeId,
                "Context stats task",
                null,
                null,
                null,
                [
                    new ReviewTaskShotCreateRequest(lensA.Id, 1, lensA.VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(lensB!.Id, 2, lensB.VersionNum, "context")
                ]),
            JsonOptions).ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);

        Assert.NotNull(taskResponse);
        Assert.Equal(1, taskResponse!.Summary!.ShotCount);
        Assert.Equal(0, taskResponse.Summary.PendingFeedbackCount);
        Assert.Equal("review", taskResponse.Shots[0].ParticipationMode);
        Assert.Equal("context", taskResponse.Shots[1].ParticipationMode);
    }

    [Fact]
    public async Task Mixed_task_complete_ignores_context_shots_but_context_feedback_is_blocked()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lensA, project) = await CreateProjectEpisodeLensAsync(adminClient, "MIXED-COMPLETE");
        var lensB = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{lensA!.EpisodeId}/lenses",
            new LensCreateRequest("L002", "Lens 2", 2, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        lensA = await TransitionToStatusAsync(adminClient, lensA!, "READY_FOR_REVIEW");

        var taskResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/tasks",
            new ReviewTaskCreateRequest(
                project!.Code,
                lensA.EpisodeId,
                "Mixed complete task",
                null,
                null,
                null,
                [
                    new ReviewTaskShotCreateRequest(lensA.Id, 1, lensA.VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(lensB!.Id, 2, lensB.VersionNum, "context")
                ]),
            JsonOptions).ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);

        Assert.NotNull(taskResponse);

        var detailBefore = await adminClient.GetFromJsonAsync<ReviewTaskResponse>($"/api/review-tasks/{taskResponse!.Id}", JsonOptions);
        Assert.NotNull(detailBefore);

        await adminClient.PostAsJsonAsync($"/api/review-tasks/tasks/{taskResponse.Id}/submit", new { }, JsonOptions);
        await adminClient.PostAsJsonAsync($"/api/review-tasks/tasks/{taskResponse.Id}/start", new { }, JsonOptions);

        var feedbackResponse = await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskResponse.Id,
                lensB.Id,
                lensB.VersionNum,
                null,
                null,
                "Context shot should be blocked",
                null,
                "CHANGE_REQUEST",
                null,
                null,
                null,
                null,
                detailBefore!.Shots.First(x => x.ParticipationMode == "context").LatestFeedbackId),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Conflict, feedbackResponse.StatusCode);

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskResponse.Id,
                lensA.Id,
                lensA.VersionNum,
                null,
                null,
                "Review shot feedback",
                null,
                "APPROVE",
                null,
                null,
                null,
                null,
                detailBefore!.Shots.First(x => x.ParticipationMode == "review").LatestFeedbackId),
            JsonOptions);

        var completeResponse = await adminClient.PostAsync($"/api/review-tasks/tasks/{taskResponse.Id}/complete", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.OK, completeResponse.StatusCode);
    }

    [Fact]
    public async Task Six_shot_mixed_task_keeps_context_read_only_and_only_review_shots_control_complete()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lensA, project) = await CreateProjectEpisodeLensAsync(adminClient, "MIXED-SIX-SHOT");
        var extraLenses = new List<LensResponse>();
        for (var i = 2; i <= 6; i++)
        {
            var extraLens = await adminClient.PostAsJsonAsync(
                $"/api/episodes/{lensA!.EpisodeId}/lenses",
                new LensCreateRequest($"L00{i}", $"Lens {i}", i, null, null, null, null, null),
                JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);
            Assert.NotNull(extraLens);
            extraLenses.Add(extraLens!);
        }

        lensA = await TransitionToStatusAsync(adminClient, lensA!, "READY_FOR_REVIEW");

        var taskResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/tasks",
            new ReviewTaskCreateRequest(
                project!.Code,
                lensA.EpisodeId,
                "Six shot mixed task",
                null,
                null,
                null,
                [
                    new ReviewTaskShotCreateRequest(lensA.Id, 1, lensA.VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(extraLenses[0].Id, 2, extraLenses[0].VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(extraLenses[1].Id, 3, extraLenses[1].VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(extraLenses[2].Id, 4, extraLenses[2].VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(extraLenses[3].Id, 5, extraLenses[3].VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(extraLenses[4].Id, 6, extraLenses[4].VersionNum, "context")
                ]),
            JsonOptions).ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);

        Assert.NotNull(taskResponse);
        Assert.Equal(6, taskResponse!.Shots.Count);
        Assert.Equal(5, taskResponse.Summary!.ShotCount);

        await adminClient.PostAsJsonAsync($"/api/review-tasks/tasks/{taskResponse.Id}/submit", new { }, JsonOptions);
        await adminClient.PostAsJsonAsync($"/api/review-tasks/tasks/{taskResponse.Id}/start", new { }, JsonOptions);

        var detailBefore = await adminClient.GetFromJsonAsync<ReviewTaskResponse>($"/api/review-tasks/{taskResponse.Id}", JsonOptions);
        Assert.NotNull(detailBefore);

        var reviewShots = detailBefore!.Shots.Where(shot => shot.ParticipationMode == "review").ToArray();
        var contextShot = detailBefore.Shots.First(shot => shot.ParticipationMode == "context");

        var blockedContextFeedback = await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskResponse.Id,
                extraLenses[4].Id,
                extraLenses[4].VersionNum,
                null,
                null,
                "Context shot feedback should be blocked",
                null,
                "CHANGE_REQUEST",
                null,
                null,
                null,
                null,
                contextShot.Id),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Conflict, blockedContextFeedback.StatusCode);

        foreach (var shot in reviewShots)
        {
            var sourceLens = shot.LensId == lensA.Id ? lensA : extraLenses.First(extra => extra.Id == shot.LensId);
            var decisionCode = shot.LensId == lensA.Id ? "CHANGE_REQUEST" : "APPROVE";
            var text = shot.LensId == lensA.Id ? "Formal review shot feedback" : $"Formal review shot {shot.LensCode} approved";

            var reviewFeedbackResponse = await adminClient.PostAsJsonAsync(
                "/api/review-feedbacks",
                new ReviewFeedbackCreateRequest(
                    taskResponse.Id,
                    sourceLens.Id,
                    sourceLens.VersionNum,
                    null,
                    null,
                    text,
                    null,
                    decisionCode,
                    null,
                    null,
                    null,
                    null,
                    shot.Id),
                JsonOptions);

            Assert.Equal(HttpStatusCode.Created, reviewFeedbackResponse.StatusCode);
        }

        var completeResponse = await adminClient.PostAsync($"/api/review-tasks/tasks/{taskResponse.Id}/complete", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.OK, completeResponse.StatusCode);

        var blockedTaskResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/tasks",
            new ReviewTaskCreateRequest(
                project.Code,
                lensA.EpisodeId,
                "Six shot mixed task - review context blocked",
                null,
                null,
                null,
                [
                    new ReviewTaskShotCreateRequest(lensA.Id, 1, lensA.VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(extraLenses[0].Id, 2, extraLenses[0].VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(extraLenses[1].Id, 3, extraLenses[1].VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(extraLenses[2].Id, 4, extraLenses[2].VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(extraLenses[3].Id, 5, extraLenses[3].VersionNum, "review"),
                    new ReviewTaskShotCreateRequest(extraLenses[4].Id, 6, extraLenses[4].VersionNum, "review")
                ]),
            JsonOptions).ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);

        Assert.NotNull(blockedTaskResponse);
        await adminClient.PostAsJsonAsync($"/api/review-tasks/tasks/{blockedTaskResponse!.Id}/submit", new { }, JsonOptions);
        await adminClient.PostAsJsonAsync($"/api/review-tasks/tasks/{blockedTaskResponse.Id}/start", new { }, JsonOptions);

        var blockedComplete = await adminClient.PostAsync($"/api/review-tasks/tasks/{blockedTaskResponse.Id}/complete", new StringContent(string.Empty));
        Assert.Equal(HttpStatusCode.Conflict, blockedComplete.StatusCode);
    }

    [Fact]
    public async Task Director_approved_lens_can_be_read_back_after_approve_action()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, _) = await CreateProjectEpisodeLensAsync(adminClient, "FB-APPROVED");

        var approved = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{lens!.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("READY_FOR_REVIEW", null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);
        approved = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{approved!.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("IN_DIRECTOR_REVIEW", null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);
        approved = await adminClient.PutAsJsonAsync(
            $"/api/lenses/{approved!.Id}/internal-review-status",
            new LensInternalReviewStatusUpdateRequest("DIRECTOR_APPROVED", null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        Assert.NotNull(approved);
        Assert.Equal("DIRECTOR_APPROVED", approved!.InternalReviewStatusCode);
    }

    [Fact]
    public async Task Feedback_round_and_drawings_can_be_read_back_by_lens()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-IMMED");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", null, null,
                "Immediate check", null, "CHANGE_REQUEST", null, null, null, null),
            JsonOptions);

        var round = await adminClient.GetFromJsonAsync<ReviewFeedbackLensResponse>(
            $"/api/reviews/lens/{lens.Id}/feedbacks", JsonOptions);

        Assert.NotNull(round);
        Assert.NotNull(round!.LatestFeedbackRoundId);
        Assert.NotEmpty(round.Feedbacks);
        Assert.Contains(round.Feedbacks, f => f.Content == "Immediate check");
    }

    [Fact]
    public async Task Feedback_round_query_keeps_rounds_isolated()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-ROUND-ISO");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);
        var round1 = Guid.NewGuid();
        var round2 = Guid.NewGuid();

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", 12, "00:00:12.000",
                "Round one", null, "CHANGE_REQUEST", null, null, null, null, null, round1,
                [new ReviewDrawingFrameUpsertRequest(1, 12.5, "00:00:12.500", "DRAWN", "{\"paths\":[{\"x\":1}]}")]),
            JsonOptions);

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens.Id, "V01", 13, "00:00:13.000",
                "Round two", null, "CHANGE_REQUEST", null, null, null, null, null, round2,
                [new ReviewDrawingFrameUpsertRequest(1, 13.5, "00:00:13.500", "CLEAR", null)]),
            JsonOptions);

        var latestRound = await adminClient.GetFromJsonAsync<ReviewFeedbackLensResponse>(
            $"/api/reviews/lens/{lens.Id}/feedbacks", JsonOptions);
        Assert.Equal(round2, latestRound!.LatestFeedbackRoundId);
        Assert.Single(latestRound.Feedbacks);
        Assert.Equal("Round two", latestRound.Feedbacks[0].Content);
        Assert.Single(latestRound.DrawingFrames);
        Assert.Equal("CLEAR", latestRound.DrawingFrames[0].DrawingStateCode);

        var round1Only = await adminClient.GetFromJsonAsync<ReviewFeedbackLensResponse>(
            $"/api/reviews/lens/{lens.Id}/feedbacks?feedbackRoundId={round1}", JsonOptions);
        Assert.Equal(round1, round1Only!.LatestFeedbackRoundId);
        Assert.Single(round1Only.Feedbacks);
        Assert.Equal("Round one", round1Only.Feedbacks[0].Content);
        Assert.Single(round1Only.DrawingFrames);
        Assert.Equal("DRAWN", round1Only.DrawingFrames[0].DrawingStateCode);
    }

    [Fact]
    public async Task Feedbacks_in_same_round_share_feedbackRoundId_and_read_back_all_drawings()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-SAME-ROUND");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);
        var roundId = Guid.NewGuid();

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", 12, "00:00:12.000",
                "Round shared 1", null, "CHANGE_REQUEST", null, null, null, null, null, roundId,
                [
                    new ReviewDrawingFrameUpsertRequest(1, 12.5, "00:00:12.500", "DRAWN", "{\"paths\":[{\"x\":1}]}") ,
                    new ReviewDrawingFrameUpsertRequest(2, 13.5, "00:00:13.500", "CLEAR", null)
                ]),
            JsonOptions);

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens.Id, "V01", 14, "00:00:14.000",
                "Round shared 2", null, "CHANGE_REQUEST", null, null, null, null, null, roundId,
                [new ReviewDrawingFrameUpsertRequest(3, 14.5, "00:00:14.500", "DRAWN", "{\"paths\":[{\"x\":2}]}")]),
            JsonOptions);

        var round = await adminClient.GetFromJsonAsync<ReviewFeedbackLensResponse>(
            $"/api/reviews/lens/{lens.Id}/feedbacks?feedbackRoundId={roundId}", JsonOptions);

        Assert.NotNull(round);
        Assert.Equal(roundId, round!.LatestFeedbackRoundId);
        Assert.Equal(2, round.Feedbacks.Count);
        Assert.All(round.Feedbacks, f => Assert.Equal(roundId, f.FeedbackRoundId));
        Assert.Equal(3, round.DrawingFrames.Count);
        Assert.Contains(round.DrawingFrames, f => f.DrawingStateCode == "CLEAR");

        var totalFrames = round.Feedbacks.Sum(f => f.DrawingFrames?.Count ?? 0);
        Assert.Equal(3, totalFrames);
    }

    [Fact]
    public async Task Lens_feedback_query_returns_only_current_lens_feedback()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lensA, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-LENS-BOUNDARY");
        var lensB = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{lensA!.EpisodeId}/lenses",
            new LensCreateRequest("L002", "Lens 2", 2, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        var draftResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project!.Code, lensA.EpisodeId, "Boundary Task", null, null, null, [lensA.Id, lensB!.Id]),
            JsonOptions);

        Assert.True(draftResponse.IsSuccessStatusCode);
        var draftBody = await draftResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var taskId = draftBody.GetProperty("taskId").GetGuid();

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lensA.Id, "V01", null, null,
                "Lens A only", null, "CHANGE_REQUEST", null, null, null, null),
            JsonOptions);

        var lensBFeedbacks = await adminClient.GetFromJsonAsync<ReviewFeedbackLensResponse>(
            $"/api/review-feedbacks/lens/{lensB.Id}", JsonOptions);

        Assert.NotNull(lensBFeedbacks);
        Assert.Null(lensBFeedbacks!.LatestFeedbackRoundId);
        Assert.Empty(lensBFeedbacks.Feedbacks);
        Assert.Empty(lensBFeedbacks.DrawingFrames);

        var lensBDrawingFrames = await adminClient.GetFromJsonAsync<IReadOnlyList<ReviewDrawingFrameResponse>>(
            $"/api/review-feedbacks/lens/{lensB.Id}/drawings", JsonOptions);

        Assert.NotNull(lensBDrawingFrames);
        Assert.Empty(lensBDrawingFrames!);
    }

    [Fact]
    public async Task Task_detail_has_correct_feedback_count_after_feedback_creation()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-COUNT");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);

        var detailBefore = await adminClient.GetFromJsonAsync<JsonElement>(
            $"/api/review-tasks/{taskId}/detail", JsonOptions);
        var shotCountBefore = detailBefore.GetProperty("totalShots").GetInt32();
        var feedbackCountBefore = detailBefore.GetProperty("feedbackCount").GetInt32();

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", null, null,
                "Count check 1", null, "CHANGE_REQUEST", null, null, null, null),
            JsonOptions);

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", null, null,
                "Count check 2", null, "CHANGE_REQUEST", null, null, null, null),
            JsonOptions);

        var detailAfter = await adminClient.GetFromJsonAsync<JsonElement>(
            $"/api/review-tasks/{taskId}/detail", JsonOptions);

        Assert.Equal(shotCountBefore, detailAfter.GetProperty("totalShots").GetInt32());
        Assert.Equal(feedbackCountBefore + 2, detailAfter.GetProperty("feedbackCount").GetInt32());
        Assert.True(detailAfter.TryGetProperty("latestFeedbackAtUtc", out _));
    }

    [Fact]
    public async Task Task_detail_returns_stable_shot_order_and_versions()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens1, project) = await CreateProjectEpisodeLensAsync(adminClient, "ORDER-TEST");
        var lens2 = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{lens1!.EpisodeId}/lenses",
            new LensCreateRequest("S002", "Lens 2", 2, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        var lens1Ready = await TransitionToStatusAsync(adminClient, lens1, "READY_FOR_REVIEW");
        var lens2Ready = await TransitionToStatusAsync(adminClient, lens2!, "READY_FOR_REVIEW");

        var draftResponse = await adminClient.PostAsJsonAsync(
            "/api/review-tasks/draft",
            new ProducerReviewTaskCreateRequest(
                project!.Code, null, "Order Test", null, null, null,
                [lens1.Id, lens2!.Id]),
            JsonOptions);
        Assert.True(draftResponse.IsSuccessStatusCode);
        var draftBody = await draftResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var taskId = draftBody.GetProperty("taskId").GetGuid();

        await adminClient.PostAsJsonAsync(
            $"/api/review-tasks/{taskId}/submit", new { }, JsonOptions);

        var detail = await adminClient.GetFromJsonAsync<JsonElement>(
            $"/api/review-tasks/{taskId}/detail", JsonOptions);

        var shots = detail.GetProperty("shots").EnumerateArray().ToArray();
        Assert.Equal(2, shots.Length);
        Assert.Equal(lens1.Id.ToString(), shots[0].GetProperty("shotId").GetString());
        Assert.Equal(lens2.Id.ToString(), shots[1].GetProperty("shotId").GetString());
        Assert.Equal(1, shots[0].GetProperty("sortOrder").GetInt32());
        Assert.Equal(2, shots[1].GetProperty("sortOrder").GetInt32());
        Assert.True(shots[0].TryGetProperty("submitVersionNum", out _));
        Assert.True(shots[0].TryGetProperty("actualVersionNum", out _));
        Assert.True(shots[0].TryGetProperty("hasPlayableMedia", out _));
    }

    [Fact]
    public async Task Create_feedback_with_invalid_taskShotId_is_rejected()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "TSID-REJ");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);

        var otherLens = await adminClient.PostAsJsonAsync(
            $"/api/episodes/{lens!.EpisodeId}/lenses",
            new LensCreateRequest("S002", "Other Lens", 2, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        var otherTaskId = await CreateAndSubmitReviewTaskAsync(adminClient, otherLens!, project!);

        var otherDetail = await adminClient.GetFromJsonAsync<JsonElement>(
            $"/api/review-tasks/{otherTaskId}/detail", JsonOptions);
        var otherShotId = otherDetail.GetProperty("shots").EnumerateArray().First()
            .GetProperty("taskShotId").GetGuid();

        var response = await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens.Id, "V01", null, null,
                "Invalid taskShotId", null, "CHANGE_REQUEST",
                null, null, null, null, otherShotId),
            JsonOptions);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Feedback_lens_feedback_count_updates_after_create_and_delete()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "FB-CNT-DEL");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);

        var fb1 = await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", null, null,
                "First", null, "CHANGE_REQUEST", null, null, null, null),
            JsonOptions).ReadAsJsonAsync<ReviewCommentResponse>(JsonOptions);

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens.Id, "V01", null, null,
                "Second", null, "CHANGE_REQUEST", null, null, null, null),
            JsonOptions);

        var lensPending = await adminClient.GetFromJsonAsync<LensResponse>(
            $"/api/lenses/{lens.Id}", JsonOptions);
        Assert.Equal(2, lensPending!.PendingDirectorFeedbackCount);

        await adminClient.DeleteAsync($"/api/review-feedbacks/{fb1!.Id}");

        var lensAfter = await adminClient.GetFromJsonAsync<LensResponse>(
            $"/api/lenses/{lens.Id}", JsonOptions);
        Assert.Equal(1, lensAfter!.PendingDirectorFeedbackCount);
    }

    [Fact]
    public async Task Producer_task_summary_includes_feedback_count_and_latest_time()
    {
        using var factory = CreateFactory();
        await ResetDatabaseAsync(factory);
        using var adminClient = await CreateAdminClientAsync(factory);

        var (lens, project) = await CreateProjectEpisodeLensAsync(adminClient, "SUM-FB");
        var taskId = await CreateAndSubmitReviewTaskAsync(adminClient, lens!, project!);

        var summaryBefore = await adminClient.GetFromJsonAsync<JsonElement>(
            $"/api/review-tasks/{taskId}/detail", JsonOptions);
        Assert.True(summaryBefore.TryGetProperty("feedbackCount", out var fcBefore));
        Assert.Equal(0, fcBefore.GetInt32());

        await adminClient.PostAsJsonAsync(
            "/api/review-feedbacks",
            new ReviewFeedbackCreateRequest(
                taskId, lens!.Id, "V01", null, null,
                "Summary check", null, "CHANGE_REQUEST", null, null, null, null),
            JsonOptions);

        var summaryAfter = await adminClient.GetFromJsonAsync<JsonElement>(
            $"/api/review-tasks/{taskId}/detail", JsonOptions);
        Assert.Equal(1, summaryAfter.GetProperty("feedbackCount").GetInt32());
        Assert.True(summaryAfter.TryGetProperty("latestFeedbackAtUtc", out var latest));
        Assert.NotNull(latest.GetString());
    }

    internal static async Task<(LensResponse? Lens, ProjectCreateResponse? Project)> CreateProjectEpisodeLensAsync(
        HttpClient client, string projectCode)
    {
        var project = await client.PostAsJsonAsync(
            "/api/projects",
            new ProjectCreateRequest(projectCode, $"{projectCode} Project", null, "v1", "l1"),
            JsonOptions).ReadAsJsonAsync<ProjectCreateResponse>(JsonOptions);

        var episode = await client.PostAsJsonAsync(
            $"/api/projects/{project!.Code}/episodes",
            new EpisodeCreateRequest("E01", "Episode 1", 1, null),
            JsonOptions).ReadAsJsonAsync<EpisodeResponse>(JsonOptions);

        var lens = await client.PostAsJsonAsync(
            $"/api/episodes/{episode!.Id}/lenses",
            new LensCreateRequest("L001", "Lens 1", 1, null, null, null, null, null),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        return (lens, project);
    }

    internal static async Task<Guid> CreateAndSubmitReviewTaskAsync(HttpClient client, LensResponse lens, ProjectCreateResponse project)
    {
        var ready = await TransitionToStatusAsync(client, lens, "READY_FOR_REVIEW");
        var inReview = await TransitionToStatusAsync(client, ready, "IN_DIRECTOR_REVIEW");
        var approved = await TransitionToStatusAsync(client, inReview, "DIRECTOR_APPROVED");
        var submitted = await client.PutAsJsonAsync(
            $"/api/lenses/{approved.Id}/status",
            new LensStatusChangeRequest("SUBMITTED", null, approved.RowVersion),
            JsonOptions).ReadAsJsonAsync<LensResponse>(JsonOptions);

        var reviewReq = new ReviewSubmitRequest(lens.Id, null);
        var review = await client.PostAsJsonAsync("/api/review-tasks", reviewReq, JsonOptions)
            .ReadAsJsonAsync<ReviewTaskResponse>(JsonOptions);
        return review!.Id;
    }

    internal static async Task<ReviewTaskResponse> CreateTaskWithShotsAsync(HttpClient client, ProjectCreateResponse project, LensResponse lens, string participationMode)
    {
        var response = await client.PostAsJsonAsync(
            "/api/review-tasks/tasks",
            new ReviewTaskCreateRequest(
                project.Code,
                lens.EpisodeId,
                $"Task-{Guid.NewGuid():N}",
                null,
                null,
                null,
                [new ReviewTaskShotCreateRequest(lens.Id, 1, lens.VersionNum, participationMode)]),
            JsonOptions);

        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ReviewTaskResponse>(JsonOptions))!;
    }

    internal static async Task<LensResponse> TransitionToStatusAsync(HttpClient client, LensResponse lens, string targetStatus)
    {
        var currentReviewStatus = lens.InternalReviewStatusCode;
        if (currentReviewStatus == targetStatus) return lens;

        var current = lens;
        if (currentReviewStatus == "NOT_IN_REVIEW" && targetStatus == "READY_FOR_REVIEW" || currentReviewStatus == "FIX_UPDATED" && targetStatus == "READY_FOR_REVIEW")
        {
            var resp = await client.PutAsJsonAsync(
                $"/api/lenses/{current.Id}/internal-review-status",
                new LensInternalReviewStatusUpdateRequest("READY_FOR_REVIEW", null, null),
                JsonOptions);
            current = (await resp.Content.ReadFromJsonAsync<LensResponse>(JsonOptions))!;
        }

        if (targetStatus == "IN_DIRECTOR_REVIEW" || targetStatus == "DIRECTOR_APPROVED" || targetStatus == "PENDING_FEEDBACK_FIX")
        {
            if (current.InternalReviewStatusCode != "IN_DIRECTOR_REVIEW")
            {
                var resp = await client.PutAsJsonAsync(
                    $"/api/lenses/{current.Id}/internal-review-status",
                    new LensInternalReviewStatusUpdateRequest("IN_DIRECTOR_REVIEW", null, null),
                    JsonOptions);
                current = (await resp.Content.ReadFromJsonAsync<LensResponse>(JsonOptions))!;
            }
        }

        if (targetStatus == "DIRECTOR_APPROVED" || targetStatus == "PENDING_FEEDBACK_FIX")
        {
            var resp = await client.PutAsJsonAsync(
                $"/api/lenses/{current.Id}/internal-review-status",
                new LensInternalReviewStatusUpdateRequest(targetStatus, null, null),
                JsonOptions);
            current = (await resp.Content.ReadFromJsonAsync<LensResponse>(JsonOptions))!;
        }

        return current;
    }

    private ServerApiFactory CreateFactory() => new();

    private async Task ResetDatabaseAsync(ServerApiFactory factory)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MovtoolsDbContext>();
        var seeder = scope.ServiceProvider.GetRequiredService<DatabaseSeeder>();

        await dbContext.Database.MigrateAsync();
        await dbContext.Database.ExecuteSqlRawAsync("""
            DO $$
            DECLARE r RECORD;
            BEGIN
              FOR r IN (
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = 'public'
                  AND tablename <> '__EFMigrationsHistory'
              ) LOOP
                EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE;', r.tablename);
              END LOOP;
            END $$;
            """);
        await seeder.SeedCoreDataAsync();
    }

    private async Task<HttpClient> CreateAdminClientAsync(ServerApiFactory factory)
    {
        var client = factory.CreateClient();
        var login = await LoginAsync(client, "admin", DatabaseSeeder.AdminPassword);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.AccessToken);
        return client;
    }

    private static async Task<LoginResponse> LoginAsync(HttpClient client, string userName, string password)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(userName, password), JsonOptions);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<LoginResponse>(JsonOptions))!;
    }
}
